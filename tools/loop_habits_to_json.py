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


def classify_frequency(freq_num, freq_den, habit_label):
    """Devuelve (freq, freqCount, freqPeriod) o levanta ValueError con un
    mensaje describiendo por que es UNSUPPORTED. Decision congelada
    (Gate A, seccion 2): solo 1/1 y N/7 tienen mapeo aprobado; cualquier
    otro freq_den es UNSUPPORTED, nunca aproximado."""
    if freq_num == 1 and freq_den == 1:
        return 'daily', 1, 'week'
    if freq_den == 7:
        if not (FREQ_COUNT_MIN <= freq_num <= FREQ_COUNT_MAX):
            raise ValueError(
                f'{habit_label}: freq_num={freq_num} fuera de {FREQ_COUNT_MIN}..{FREQ_COUNT_MAX}, UNSUPPORTED.'
            )
        return 'custom', freq_num, 'week'
    raise ValueError(
        f'{habit_label}: frecuencia {freq_num}/{freq_den} no soportada (UNSUPPORTED). '
        'Solo se soportan 1/1 (daily) y N/7 (custom/week) en esta fase.'
    )


def open_readonly(db_path):
    uri = f'file:{os.path.abspath(db_path)}?mode=ro'
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

    for (loop_id, raw_name, freq_num, freq_den, archived, habit_type) in load_habits(conn):
        label = f'Loop habit id={loop_id!r} name={raw_name!r}'

        if archived:
            problems.append(f'{label}: habito archivado, UNSUPPORTED (sin representacion en Habit Tracker hoy).')
            continue

        if habit_type is not None and habit_type != schema.HABIT_TYPE_BOOLEAN:
            problems.append(f'{label}: habito cuantitativo/medible (type={habit_type}), UNSUPPORTED.')
            continue

        new_id = f'loop-{loop_id}'
        if not is_valid_id_format(new_id):
            problems.append(f'{label}: id generado "{new_id}" no cumple el formato Backup v1.')
            continue
        if is_reserved_id(new_id):
            problems.append(f'{label}: id generado "{new_id}" es una palabra reservada.')
            continue
        if new_id in seen_ids:
            problems.append(f'{label}: id generado "{new_id}" duplicado dentro del dataset.')
            continue

        if raw_name is None or not is_valid_schema_name(raw_name):
            problems.append(f'{label}: nombre invalido (vacio, ausente o fuera de {NAME_MIN_CODEPOINTS}..{NAME_MAX_CODEPOINTS} code points).')
            continue
        if has_control_chars(raw_name):
            problems.append(f'{label}: nombre contiene caracteres de control.')
            continue

        try:
            freq, freq_count, freq_period = classify_frequency(freq_num, freq_den, label)
        except ValueError as e:
            problems.append(str(e))
            continue

        completed_dates = set()
        earliest_date = None
        habit_had_problem = False
        for (ts_raw, value) in load_repetitions(conn, loop_id):
            if ts_raw is None:
                problems.append(f'{label}: repeticion con timestamp nulo, dato corrupto.')
                habit_had_problem = True
                continue
            try:
                date_str = timestamp_to_local_date(ts_raw)
            except (ValueError, OSError, OverflowError) as e:
                problems.append(f'{label}: timestamp de repeticion invalido ({ts_raw!r}): {e}')
                habit_had_problem = True
                continue

            if date_str > today_local_str:
                problems.append(f'{label}: completion futura/anomala en {date_str}.')
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
    parser = argparse.ArgumentParser(
        description='Convierte un SQLite de Loop Habit Tracker a Backup JSON v1 de Habit Tracker. '
                    'Fase sintetica: no ejecutar contra un backup real sin Gate B.'
    )
    parser.add_argument('--input', required=True, help='Ruta al archivo SQLite de entrada.')
    parser.add_argument('--output', required=True, help='Ruta del archivo JSON de salida (no debe existir).')
    args = parser.parse_args(argv)

    if not os.path.isfile(args.input):
        print(f'ERROR: no existe el archivo de entrada: {args.input}', file=sys.stderr)
        return 2

    if os.path.exists(args.output):
        print(f'ERROR: el archivo de salida ya existe: {args.output}', file=sys.stderr)
        return 2

    conn = open_readonly(args.input)
    try:
        try:
            data = convert(conn)
        except ConversionAborted as e:
            print('CONVERSION ABORTADA. Problemas detectados:', file=sys.stderr)
            for p in e.problems:
                print(f'  - {p}', file=sys.stderr)
            return 1
    finally:
        conn.close()

    write_backup_atomic(args.output, data)
    print(f'OK: {args.output}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
