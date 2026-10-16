#!/usr/bin/env python3
"""
Conversor local: Loop Habit Tracker (SQLite) -> Backup JSON v1 de Habit
Tracker.

FASE ACTUAL: solo datos sinteticos. No ejecutar contra un backup real de
Loop sin Gate B explicito (ver docs/ROADMAP.md y docs/SECURITY.md).

Principio: fail explicitly before inventing. Ante cualquier dato que no
se pueda representar fielmente en el modelo actual de Habit Tracker, el
conversor aborta la conversion COMPLETA del dataset y reporta todos los
problemas detectables -- nunca produce un backup parcial ni inventa una
equivalencia no aprobada.

Uso:
    python loop_habits_to_json.py --input ruta/a/loop.db --output ruta/a/salida.json

Sin red. Sin dependencias externas (solo stdlib).
"""

import argparse
import json
import os
import re
import sqlite3
import sys
import tempfile
import urllib.parse
from datetime import datetime, timezone

import loop_schema as schema

# ---------------------------------------------------------------------
# Contrato Backup v1, reconstruido desde js/app.js (no asumido). Si el
# contrato real cambia, este bloque debe actualizarse a mano -- ver
# docs/PROJECT_CONTEXT.md, seccion 5a/5b.
# ---------------------------------------------------------------------
ID_FORMAT_RE = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
RESERVED_IDS = {'__proto__', 'constructor', 'prototype'}
NAME_MIN_CODEPOINTS = 1
NAME_MAX_CODEPOINTS = 5000
CONTROL_CHAR_RE = re.compile(r'[\u0000-\u001F\u007F]')
FREQ_COUNT_MIN = 1
FREQ_COUNT_MAX = 30

# Decision de producto (Gate A, seccion 3): icono fijo para todo habito
# convertido. Perdida visual deliberada, editable luego en la app.
ICON_DEFAULT = '\U0001F4DA'  # 📚

# Decision de producto (Gate A, seccion 6): color sintetico fijo
# UNICAMENTE para poder construir/testear el Backup v1 mientras Gate B
# no confirme el mapeo real de color de Loop.
# TEST/SYNTHETIC DEFAULT -- NOT LOOP COLOR MAPPING.
COLOR_SYNTHETIC_DEFAULT = '#4ECDC4'

# ---------------------------------------------------------------------
# Codigos de diagnostico (PRIV-2). Los mensajes de `problems` nunca
# incluyen nombres de habito, fechas, timestamps crudos ni ningun otro
# valor historico/personal -- solo un codigo tecnico y el id interno de
# Loop (habit_id), que identifica el registro afectado sin exponer su
# contenido. Ver docs/SECURITY.md, seccion 6.
# ---------------------------------------------------------------------
CODE_ARCHIVED_HABIT = 'LOOP_ARCHIVED_HABIT'
CODE_UNSUPPORTED_QUANTITATIVE = 'LOOP_UNSUPPORTED_QUANTITATIVE'
CODE_INVALID_GENERATED_ID = 'LOOP_INVALID_GENERATED_ID'
CODE_RESERVED_GENERATED_ID = 'LOOP_RESERVED_GENERATED_ID'
CODE_DUPLICATE_GENERATED_ID = 'LOOP_DUPLICATE_GENERATED_ID'
CODE_INVALID_NAME_LENGTH = 'LOOP_INVALID_NAME_LENGTH'
CODE_NAME_CONTROL_CHARS = 'LOOP_NAME_CONTROL_CHARS'
CODE_UNSUPPORTED_FREQUENCY = 'LOOP_UNSUPPORTED_FREQUENCY'
CODE_NULL_TIMESTAMP = 'LOOP_NULL_TIMESTAMP'
CODE_INVALID_TIMESTAMP = 'LOOP_INVALID_TIMESTAMP'
CODE_FUTURE_COMPLETION = 'LOOP_FUTURE_COMPLETION'
CODE_INVALID_LOOP_ID = 'LOOP_INVALID_HABIT_ID'
CODE_ORPHANED_REPETITION = 'LOOP_ORPHANED_REPETITION'


def _safe_int(value):
    """Devuelve `value` tal cual si es exactamente int, o un marcador
    fijo no sensible si no lo es. SQLite es de tipado dinamico: una
    columna declarada INTEGER puede, ante una fila corrupta o
    malformada, contener texto arbitrario. Sin este filtro, ese texto
    terminaria reflejado tal cual en un mensaje de diagnostico.

    `type(value) is int` (no `isinstance`) excluye deliberadamente
    bool: en Python `bool` es subclase de `int`, y `isinstance(True,
    int)` es `True`. SQLite no puede devolver un bool real desde una
    columna INTEGER (lo normaliza a 0/1 como int), pero esta exclusion
    se mantiene como defensa explicita, no solo como consecuencia de
    como se comporta SQLite hoy."""
    return value if type(value) is int else '<non-numeric>'


def problem(code, habit_id):
    """Construye una entrada de `problems` a partir de un codigo tecnico
    y el id interno de Loop -- nunca a partir de datos personales."""
    return f'{code} habit_id={_safe_int(habit_id)}'


class SanitizedArgumentParser(argparse.ArgumentParser):
    """argparse.error() imprime por defecto los tokens crudos recibidos
    (ej. "unrecognized arguments: <lo que sobro>"). Si el usuario olvida
    comillas en una ruta con espacios, ese mensaje por defecto termina
    reflejando un fragmento de ruta con informacion personal (ej. el
    nombre de usuario del sistema). Este parser nunca refleja los
    argumentos recibidos en su mensaje de error."""

    def error(self, message):
        self.print_usage(sys.stderr)
        print(f'{self.prog}: error: argumentos invalidos.', file=sys.stderr)
        sys.exit(2)


class ConversionAborted(Exception):
    """Se levanta cuando el preflight encuentra uno o mas problemas
    fatales/UNSUPPORTED. Contiene la lista completa de problemas
    detectados en todo el dataset, no solo el primero."""

    def __init__(self, problems):
        self.problems = list(problems)
        super().__init__(f'{len(self.problems)} problema(s) detectado(s); conversion abortada.')


def count_code_points(value):
    """Python's str ya es una secuencia de code points Unicode (a
    diferencia de JS, donde .length cuenta unidades UTF-16); len()
    alcanza, pero se nombra explicitamente para dejar claro que esto
    replica la regla de validateBackup() en js/app.js."""
    return len(value)


def is_valid_loop_id(value):
    """True solo si `value` es exactamente un int (nunca bool, nunca
    texto, nunca None). El id interno de Loop debe validarse asi antes
    de generar el id de destino o de usarse en cualquier otra
    operacion -- nunca se convierte con str() en silencio."""
    return type(value) is int


def is_valid_id_format(value):
    return isinstance(value, str) and bool(ID_FORMAT_RE.match(value))


def is_reserved_id(value):
    return value in RESERVED_IDS


def is_valid_schema_name(value):
    if not isinstance(value, str):
        return False
    n = count_code_points(value)
    return NAME_MIN_CODEPOINTS <= n <= NAME_MAX_CODEPOINTS


def has_control_chars(value):
    return bool(CONTROL_CHAR_RE.search(value))


def timestamp_to_local_date(ts_raw):
    """Convierte un timestamp de Repetitions (suposicion: milisegundos
    UTC, ver loop_schema.TIMESTAMP_UNIT) a 'YYYY-MM-DD' en la zona
    horaria LOCAL de esta maquina -- el mismo criterio que usa
    toLocalDateStr() en la app web para el navegador del usuario.

    Deliberadamente pasa primero por un datetime consciente de UTC y
    recien despues convierte a local, para no caer en el bug clasico de
    tratar un timestamp UTC como si ya fuera local."""
    seconds = ts_raw / 1000.0
    dt_utc = datetime.fromtimestamp(seconds, tz=timezone.utc)
    dt_local = dt_utc.astimezone()
    return dt_local.strftime('%Y-%m-%d')


def classify_frequency(freq_num, freq_den, habit_id):
    """Devuelve (freq, freqCount, freqPeriod) o levanta ValueError con un
    mensaje tecnico (codigo + habit_id + freq_num/freq_den, sin datos
    personales) describiendo por que es UNSUPPORTED. freq_num/freq_den
    son configuracion del habito, no historial personal. Decision
    congelada (Gate A, seccion 2): solo 1/1 y N/7 tienen mapeo aprobado;
    cualquier otro freq_den es UNSUPPORTED, nunca aproximado."""
    if freq_num == 1 and freq_den == 1:
        return 'daily', 1, 'week'
    if freq_den == 7:
        if not (FREQ_COUNT_MIN <= freq_num <= FREQ_COUNT_MAX):
            raise ValueError(
                f'{CODE_UNSUPPORTED_FREQUENCY} habit_id={_safe_int(habit_id)} '
                f'freq_num={_safe_int(freq_num)} freq_den={_safe_int(freq_den)}'
            )
        return 'custom', freq_num, 'week'
    raise ValueError(
        f'{CODE_UNSUPPORTED_FREQUENCY} habit_id={_safe_int(habit_id)} '
        f'freq_num={_safe_int(freq_num)} freq_den={_safe_int(freq_den)}'
    )


def build_readonly_uri(abs_path):
    """Construye el URI `file:` para abrir `abs_path` exclusivamente en
    modo lectura. Percent-encodea todo caracter que no este
    explicitamente marcado como seguro -- en particular '?', '#' y
    '%' -- para que ninguno trunque ni reinterprete el URI: un '#' sin
    encodear corta el URI ahi mismo (perdiendo el sufijo '?mode=ro',
    lo que abriria en lectura-escritura real en vez de solo lectura), y
    un '?' sin encodear podria introducir un segundo delimitador de
    query. ':' y '\\' se mantienen literales para que las rutas de
    Windows (unidad + separadores) sigan interpretandose igual que
    antes de este cambio."""
    encoded = urllib.parse.quote(abs_path, safe='/:\\')
    return f'file:{encoded}?mode=ro'


def open_readonly(db_path):
    uri = build_readonly_uri(os.path.abspath(db_path))
    return sqlite3.connect(uri, uri=True)


def load_habits(conn):
    cur = conn.cursor()
    cur.execute(
        f'SELECT {schema.COL_HABIT_ID}, {schema.COL_HABIT_NAME}, '
        f'{schema.COL_HABIT_FREQ_NUM}, {schema.COL_HABIT_FREQ_DEN}, '
        f'{schema.COL_HABIT_ARCHIVED}, {schema.COL_HABIT_TYPE} '
        f'FROM {schema.TABLE_HABITS}'
    )
    return cur.fetchall()


def load_repetitions(conn, habit_id):
    cur = conn.cursor()
    cur.execute(
        f'SELECT {schema.COL_REPETITION_TIMESTAMP}, {schema.COL_REPETITION_VALUE} '
        f'FROM {schema.TABLE_REPETITIONS} WHERE {schema.COL_REPETITION_HABIT_ID} = ?',
        (habit_id,),
    )
    return cur.fetchall()


def load_distinct_repetition_habit_ids(conn):
    """Todos los habit_id distintos presentes en Repetitions, sin
    filtrar por los que existen en Habits -- sirve para detectar
    repeticiones huerfanas (ver convert())."""
    cur = conn.cursor()
    cur.execute(f'SELECT DISTINCT {schema.COL_REPETITION_HABIT_ID} FROM {schema.TABLE_REPETITIONS}')
    return [row[0] for row in cur.fetchall()]


def convert(conn, today_local_str=None):
    """Corre el preflight completo sobre todo el dataset y, si no hay
    ningun problema, devuelve el dict Backup v1 listo para serializar.
    Si hay cualquier problema fatal/UNSUPPORTED, levanta
    ConversionAborted con la lista COMPLETA de problemas detectados --
    nunca con solo el primero, y nunca devuelve un resultado parcial."""
    problems = []
    out_habits = []
    out_completions = {}
    seen_ids = set()

    if today_local_str is None:
        today_local_str = datetime.now().astimezone().strftime('%Y-%m-%d')

    habit_rows = load_habits(conn)
    known_habit_ids = {row[0] for row in habit_rows}

    # Repeticiones cuyo habit_id no corresponde a ninguna fila de Habits
    # (el escenario que la migracion oficial 22 de Loop limpiaba con
    # DELETE antes de crear la restriccion unica): fail-closed explicito
    # en vez de ignorarlas en silencio. Solo lectura -- esta es otra
    # consulta mas sobre la misma conexion abierta en modo ro; nunca se
    # escribe en la base original.
    for rep_habit_id in load_distinct_repetition_habit_ids(conn):
        if rep_habit_id not in known_habit_ids:
            problems.append(problem(CODE_ORPHANED_REPETITION, rep_habit_id))

    for (loop_id, raw_name, freq_num, freq_den, archived, habit_type) in habit_rows:
        # El id interno de Loop debe ser un entero genuino antes de
        # generar el id de destino o de usarse en cualquier otra
        # operacion -- nunca se convierte con str() en silencio.
        if not is_valid_loop_id(loop_id):
            problems.append(problem(CODE_INVALID_LOOP_ID, loop_id))
            continue

        if archived:
            problems.append(problem(CODE_ARCHIVED_HABIT, loop_id))
            continue

        if habit_type is not None and habit_type != schema.HABIT_TYPE_BOOLEAN:
            problems.append(problem(CODE_UNSUPPORTED_QUANTITATIVE, loop_id))
            continue

        new_id = f'loop-{loop_id}'
        if not is_valid_id_format(new_id):
            problems.append(problem(CODE_INVALID_GENERATED_ID, loop_id))
            continue
        if is_reserved_id(new_id):
            problems.append(problem(CODE_RESERVED_GENERATED_ID, loop_id))
            continue
        if new_id in seen_ids:
            problems.append(problem(CODE_DUPLICATE_GENERATED_ID, loop_id))
            continue

        if raw_name is None or not is_valid_schema_name(raw_name):
            problems.append(problem(CODE_INVALID_NAME_LENGTH, loop_id))
            continue
        if has_control_chars(raw_name):
            problems.append(problem(CODE_NAME_CONTROL_CHARS, loop_id))
            continue

        # SQLite es de tipado dinamico: una fila corrupta podria traer
        # freq_num/freq_den no enteros. classify_frequency() compara con
        # <= directamente; sin este chequeo previo, un tipo incompatible
        # levantaria TypeError (no ValueError) y escaparia de convert()
        # sin agregarse a `problems`, perdiendo la garantia de reportar
        # todos los problemas del dataset.
        if not (isinstance(freq_num, int) and isinstance(freq_den, int)):
            problems.append(problem(CODE_UNSUPPORTED_FREQUENCY, loop_id))
            continue

        try:
            freq, freq_count, freq_period = classify_frequency(freq_num, freq_den, loop_id)
        except ValueError as e:
            problems.append(str(e))
            continue

        completed_dates = set()
        earliest_date = None
        habit_had_problem = False
        for (ts_raw, value) in load_repetitions(conn, loop_id):
            if ts_raw is None:
                problems.append(problem(CODE_NULL_TIMESTAMP, loop_id))
                habit_had_problem = True
                continue
            try:
                date_str = timestamp_to_local_date(ts_raw)
            except (ValueError, OSError, OverflowError, TypeError):
                # TypeError cubre un ts_raw no numerico (fila corrupta);
                # sin esto escaparia de convert() sin reportarse.
                problems.append(problem(CODE_INVALID_TIMESTAMP, loop_id))
                habit_had_problem = True
                continue

            if date_str > today_local_str:
                problems.append(problem(CODE_FUTURE_COMPLETION, loop_id))
                habit_had_problem = True
                continue

            if value == schema.VALUE_COMPLETED:
                # Multiples repeticiones completadas el mismo dia local
                # (ej. por un efecto de borde horario) se funden en una
                # sola entrada true: el resultado es identico y no hay
                # perdida de informacion ni ambiguedad real que reportar.
                completed_dates.add(date_str)
                if earliest_date is None or date_str < earliest_date:
                    earliest_date = date_str
            # value != VALUE_COMPLETED: repeticion no completada, no
            # aporta una entrada true y no es un error.

        if habit_had_problem:
            continue

        # createdAt: prioridad B (primera completion) -> C (fecha de
        # conversion). Prioridad A (campo real de Loop) NO implementada
        # en esta fase (Gate A, seccion 7).
        if earliest_date is not None:
            created_at = earliest_date
        else:
            created_at = today_local_str

        seen_ids.add(new_id)
        out_habits.append({
            'id': new_id,
            'name': raw_name,
            'icon': ICON_DEFAULT,
            'color': COLOR_SYNTHETIC_DEFAULT,
            'freq': freq,
            'freqCount': freq_count,
            'freqPeriod': freq_period,
            'createdAt': created_at,
        })
        for d in completed_dates:
            out_completions.setdefault(d, {})[new_id] = True

    if problems:
        raise ConversionAborted(problems)

    exported_at = datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    return {
        'schemaVersion': 1,
        'exportedAt': exported_at,
        'habits': out_habits,
        'completions': out_completions,
    }


def write_backup_atomic(output_path, data):
    """No sobrescribe un archivo existente. Escribe primero a un
    temporal en el mismo directorio y recien lo mueve al destino final
    si la serializacion completa; si algo falla antes, el output no
    debe aparecer en absoluto."""
    if os.path.exists(output_path):
        raise FileExistsError(
            f'El archivo de salida ya existe: {output_path}. '
            'No se sobrescribe automaticamente; elegi otra ruta o eliminalo manualmente.'
        )
    output_dir = os.path.dirname(os.path.abspath(output_path)) or '.'
    fd, tmp_path = tempfile.mkstemp(prefix='.loop_convert_', dir=output_dir)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, output_path)
    except Exception:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        raise


def main(argv=None):
    parser = SanitizedArgumentParser(
        description='Convierte un SQLite de Loop Habit Tracker a Backup JSON v1 de Habit Tracker. '
                    'Fase sintetica: no ejecutar contra un backup real sin Gate B.'
    )
    parser.add_argument('--input', required=True, help='Ruta al archivo SQLite de entrada.')
    parser.add_argument('--output', required=True, help='Ruta del archivo JSON de salida (no debe existir).')
    args = parser.parse_args(argv)

    # Mensajes de error con solo el nombre de archivo (nunca la ruta
    # completa): no es necesaria para diagnosticar y una ruta absoluta
    # puede filtrar informacion personal (ej. el nombre de usuario del
    # sistema operativo) si esta salida se comparte fuera de esta maquina.
    input_name = os.path.basename(args.input)
    output_name = os.path.basename(args.output)

    if not os.path.isfile(args.input):
        print(f'ERROR: no existe el archivo de entrada: {input_name}', file=sys.stderr)
        return 2

    if os.path.exists(args.output):
        print(f'ERROR: el archivo de salida ya existe: {output_name}', file=sys.stderr)
        return 2

    # Cualquier excepcion inesperada (ej. el archivo no es un SQLite
    # valido) se reporta de forma sanitizada -- nunca se deja propagar un
    # traceback crudo, que podria incluir la ruta completa o el mensaje
    # nativo de SQLite sin control sobre su contenido.
    try:
        conn = open_readonly(args.input)
    except Exception:
        print(f'ERROR: no se pudo abrir el archivo de entrada como SQLite de solo lectura: {input_name}', file=sys.stderr)
        return 2

    try:
        try:
            data = convert(conn)
        except ConversionAborted as e:
            print('CONVERSION ABORTADA. Problemas detectados:', file=sys.stderr)
            for p in e.problems:
                print(f'  - {p}', file=sys.stderr)
            return 1
        except Exception as e:
            print(f'ERROR: fallo inesperado durante la conversion ({type(e).__name__}).', file=sys.stderr)
            return 2
    finally:
        conn.close()

    try:
        write_backup_atomic(args.output, data)
    except FileExistsError:
        print(f'ERROR: el archivo de salida ya existe: {output_name}', file=sys.stderr)
        return 2
    except Exception as e:
        print(f'ERROR: fallo inesperado al escribir la salida ({type(e).__name__}).', file=sys.stderr)
        return 2

    print(f'OK: {output_name}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
