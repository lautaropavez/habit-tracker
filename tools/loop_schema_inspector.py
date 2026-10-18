#!/usr/bin/env python3
"""
Inspector de metadatos estructurales de SQLite para Gate B-1 (Habit
Tracker <- Loop Habit Tracker).

Lee EXCLUSIVAMENTE metadatos de esquema -- PRAGMA user_version,
table_info, index_list, index_info, foreign_key_list -- nunca filas de
datos, nunca sqlite_master.sql/DDL completo, nunca integrity_check.
Disenado para ejecutarse, bajo autorizacion humana explicita y
separada por archivo y por ejecucion (ver docs/SECURITY.md, seccion
7), sobre una copia de trabajo ubicada exclusivamente dentro de
/.loop-private/WORKING/ -- nunca sobre el original.

La raiz aprobada (_APPROVED_WORKING_DIR) esta fijada por este modulo a
partir de su propia ubicacion en el repositorio -- inspect() no acepta
ningun directorio alternativo como argumento del llamador. Nada fuera
de este archivo puede hacer que inspect() lea un archivo ubicado en
ORIGINAL/ ni en ninguna otra carpeta.

Reutiliza open_readonly() de loop_habits_to_json.py sin reimplementar
la apertura de conexion; esa funcion ya usa build_readonly_uri()
internamente (percent-encoding seguro de '?', '#', '%').

Fail-closed: cualquier condicion insegura o fallo levanta
InspectionAborted con un unico codigo tecnico fijo, nunca con la ruta
real, el nombre de archivo, ni el texto de la excepcion original.
"""
import os
import re

import loop_schema as schema
from loop_habits_to_json import open_readonly

CODE_PATH_ESCAPES_WORKING = 'INSPECT_PATH_ESCAPES_WORKING'
CODE_NOT_FOUND = 'INSPECT_NOT_FOUND'
CODE_NOT_REGULAR_FILE = 'INSPECT_NOT_REGULAR_FILE'
CODE_WAL_OR_SHM_PRESENT = 'INSPECT_WAL_OR_SHM_PRESENT'
CODE_SQLITE_OPEN_FAILED = 'INSPECT_SQLITE_OPEN_FAILED'
CODE_METADATA_QUERY_FAILED = 'INSPECT_METADATA_QUERY_FAILED'
CODE_UNEXPECTED_AUXILIARY_FILE = 'INSPECT_UNEXPECTED_AUXILIARY_FILE_AFTER_CLOSE'

UNKNOWN_NAME_PLACEHOLDER = 'UNKNOWN'

# Raiz aprobada, fijada por el modulo mismo (no por el llamador): la
# unica ubicacion desde la que inspect() puede leer. Un test puede
# redirigirla con mock.patch.object(inspector, '_APPROVED_WORKING_DIR',
# <dir_sintetico>) para trabajar sobre datos sinteticos sin crear ni
# tocar la carpeta real del repo.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_REPO_ROOT = os.path.dirname(_THIS_DIR)
_APPROVED_WORKING_DIR = os.path.join(_REPO_ROOT, '.loop-private', 'WORKING')

EXPECTED_HABIT_COLUMNS = (
    schema.COL_HABIT_ID,
    schema.COL_HABIT_NAME,
    schema.COL_HABIT_FREQ_NUM,
    schema.COL_HABIT_FREQ_DEN,
    schema.COL_HABIT_ARCHIVED,
    schema.COL_HABIT_TYPE,
)
EXPECTED_REPETITION_COLUMNS = (
    schema.COL_REPETITION_ID,
    schema.COL_REPETITION_HABIT_ID,
    schema.COL_REPETITION_TIMESTAMP,
    schema.COL_REPETITION_VALUE,
)
EXPECTED_TABLES = (schema.TABLE_HABITS, schema.TABLE_REPETITIONS)
_ALL_EXPECTED_COLUMNS = frozenset(EXPECTED_HABIT_COLUMNS) | frozenset(EXPECTED_REPETITION_COLUMNS)

_IDENTIFIER_RE = re.compile(r'^[A-Za-z_][A-Za-z0-9_]*$')


class InspectionAborted(Exception):
    """Unico tipo de excepcion que este modulo deja escapar hacia su
    llamador. El mensaje es siempre exactamente uno de los codigos
    CODE_* de arriba -- nunca una ruta, nunca el texto de la excepcion
    original que lo origino."""


def _resolve_within(path):
    """Resuelve `path` y la raiz aprobada a rutas reales (sin
    symlinks, sin '..') y confirma que `path` es un descendiente
    autentico de la raiz. No alcanza con comparar texto: un symlink
    dentro de la raiz que apunte afuera debe rechazarse, y eso solo se
    detecta despues de resolverlo."""
    real_working = os.path.realpath(_APPROVED_WORKING_DIR)
    real_path = os.path.realpath(path)
    try:
        common = os.path.commonpath([real_working, real_path])
    except ValueError:
        # Unidades de disco distintas en Windows (ej. C: vs D:):
        # commonpath lanza ValueError -- es "no es descendiente", no un
        # error no manejado.
        raise InspectionAborted(CODE_PATH_ESCAPES_WORKING) from None
    if common != real_working or real_path == real_working:
        raise InspectionAborted(CODE_PATH_ESCAPES_WORKING)
    return real_path


def _ensure_regular_file(real_path):
    if not os.path.exists(real_path):
        raise InspectionAborted(CODE_NOT_FOUND)
    if not os.path.isfile(real_path):
        raise InspectionAborted(CODE_NOT_REGULAR_FILE)


def _auxiliary_paths(real_path):
    return (real_path + '-wal', real_path + '-shm', real_path + '-journal')


def _check_no_auxiliary_files(real_path, code):
    """Chequeo de sistema de archivos, sin abrir SQLite. Se usa tanto
    antes de abrir (WAL/SHM/journal preexistentes pueden significar
    que la copia esta en un estado sin checkpoint) como despues de
    cerrar (cualquier auxiliar que haya aparecido durante la
    inspeccion). Nunca se intenta abrir, checkpointear ni reparar:
    siempre se aborta. Usa lexists para no seguir un symlink colgante
    que simule ser el auxiliar."""
    for aux in _auxiliary_paths(real_path):
        if os.path.lexists(aux):
            raise InspectionAborted(code)


def _ensure_safe_identifier(name):
    """Los nombres de tabla son siempre constantes propias de este
    modulo, pero los nombres de indice vienen del archivo inspeccionado
    (via PRAGMA index_list). Antes de interpolarlos en SQL, se exige
    que sean identificadores SQL simples -- defensa en profundidad, no
    la unica proteccion (SQLite ademas no permite multiples
    statements)."""
    if not _IDENTIFIER_RE.match(name):
        raise InspectionAborted(CODE_METADATA_QUERY_FAILED)
    return name


def _table_info(conn, table_name):
    _ensure_safe_identifier(table_name)
    cur = conn.cursor()
    cur.execute(f'PRAGMA table_info({table_name!r})')
    return [{'name': row[1], 'type': row[2], 'notnull': bool(row[3])} for row in cur.fetchall()]


def _index_list(conn, table_name):
    _ensure_safe_identifier(table_name)
    cur = conn.cursor()
    cur.execute(f'PRAGMA index_list({table_name!r})')
    return [{'name': row[1], 'unique': bool(row[2])} for row in cur.fetchall()]


def _index_info(conn, index_name):
    _ensure_safe_identifier(index_name)
    cur = conn.cursor()
    cur.execute(f'PRAGMA index_info({index_name!r})')
    return [row[2] for row in cur.fetchall()]


def _foreign_key_list(conn, table_name):
    _ensure_safe_identifier(table_name)
    cur = conn.cursor()
    cur.execute(f'PRAGMA foreign_key_list({table_name!r})')
    return [{'table': row[2], 'from': row[3], 'to': row[4]} for row in cur.fetchall()]


def _columns_presence(columns_info, expected_names):
    present_names = {c['name'] for c in columns_info}
    return {name: (name in present_names) for name in expected_names}


def _sanitize_name(name, expected_names):
    """Nunca devuelve un nombre de columna desconocido tal cual: si no
    esta en la whitelist esperada, se reemplaza por un marcador fijo no
    sensible."""
    return name if name in expected_names else UNKNOWN_NAME_PLACEHOLDER


def _sanitize_foreign_key(fk):
    return {
        'table': fk['table'] if fk['table'] in EXPECTED_TABLES else UNKNOWN_NAME_PLACEHOLDER,
        'from': _sanitize_name(fk['from'], _ALL_EXPECTED_COLUMNS),
        'to': _sanitize_name(fk['to'], _ALL_EXPECTED_COLUMNS),
    }


def _indices_summary(conn, table_name, expected_columns):
    """Caracteristicas estructurales de cada indice de `table_name`
    (si es unico, que columnas cubre), nunca su nombre crudo -- un
    indice autogenerado por SQLite (ej. 'sqlite_autoindex_Repetitions_1')
    no es un dato personal, pero tampoco aporta nada util al reporte y
    la decision humana fue no mostrar nombres de objetos. Las columnas
    que no pertenecen a la whitelist esperada se sanitizan igual que en
    _sanitize_foreign_key."""
    summary = []
    for idx in _index_list(conn, table_name):
        raw_columns = _index_info(conn, idx['name'])
        summary.append({
            'unique': idx['unique'],
            'columns': [_sanitize_name(c, expected_columns) for c in raw_columns],
        })
    return summary


def inspect(db_path, backup_label):
    """Inspecciona metadatos estructurales de `db_path`, que debe ser
    un descendiente real de la raiz aprobada fijada por este modulo
    (_APPROVED_WORKING_DIR) -- no existe ningun parametro para que el
    llamador sustituya esa raiz. `backup_label` es el identificador
    neutro (ej. 'BACKUP_A') que se usa en el resultado -- la ruta y el
    nombre de archivo reales nunca aparecen en el valor devuelto ni en
    ninguna excepcion.

    Devuelve un dict sanitizado. Levanta InspectionAborted ante
    cualquier condicion insegura o fallo. La conexion SQLite, si llega
    a abrirse, siempre se cierra -- incluso si una consulta de la lista
    blanca falla a mitad de camino. El chequeo de auxiliares posterior
    al cierre corre siempre, tanto si la inspeccion tuvo exito como si
    fallo."""
    real_path = _resolve_within(db_path)
    _ensure_regular_file(real_path)
    _check_no_auxiliary_files(real_path, CODE_WAL_OR_SHM_PRESENT)

    conn = None
    try:
        try:
            conn = open_readonly(real_path)
        except Exception:
            raise InspectionAborted(CODE_SQLITE_OPEN_FAILED) from None

        try:
            conn.execute('PRAGMA query_only = 1')
            user_version = conn.execute('PRAGMA user_version').fetchone()[0]
            habits_columns = _table_info(conn, schema.TABLE_HABITS)
            repetitions_columns = _table_info(conn, schema.TABLE_REPETITIONS)
            habits_indices = _indices_summary(conn, schema.TABLE_HABITS, EXPECTED_HABIT_COLUMNS)
            repetitions_indices = _indices_summary(conn, schema.TABLE_REPETITIONS, EXPECTED_REPETITION_COLUMNS)
            repetitions_fks = _foreign_key_list(conn, schema.TABLE_REPETITIONS)
        except InspectionAborted:
            raise
        except Exception:
            raise InspectionAborted(CODE_METADATA_QUERY_FAILED) from None
    finally:
        if conn is not None:
            conn.close()
        _check_no_auxiliary_files(real_path, CODE_UNEXPECTED_AUXILIARY_FILE)

    return {
        'backup': backup_label,
        'sqliteUserVersion': user_version,
        'habitsColumnsPresent': _columns_presence(habits_columns, EXPECTED_HABIT_COLUMNS),
        'repetitionsColumnsPresent': _columns_presence(repetitions_columns, EXPECTED_REPETITION_COLUMNS),
        'habitsIndices': habits_indices,
        'repetitionsIndices': repetitions_indices,
        'repetitionsForeignKeys': [_sanitize_foreign_key(fk) for fk in repetitions_fks],
    }
