"""Fixtures 100% sinteticos para probar el conversor Loop -> Backup v1.

Ninguna fila de estas funciones proviene de una base real. El esquema
usado aqui sigue las suposiciones documentadas en tools/loop_schema.py,
pendientes de reconciliacion contra un .db real bajo Gate B.
"""
import os
import sqlite3
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
import loop_schema as schema  # noqa: E402


def create_synthetic_db(path):
    """Crea el esquema sintetico habitual (con PRIMARY KEY en Habits.id,
    como lo tendria cualquier base real)."""
    conn = sqlite3.connect(path)
    conn.execute(f'''
        CREATE TABLE {schema.TABLE_HABITS} (
            {schema.COL_HABIT_ID} INTEGER PRIMARY KEY,
            {schema.COL_HABIT_NAME} TEXT,
            {schema.COL_HABIT_FREQ_NUM} INTEGER,
            {schema.COL_HABIT_FREQ_DEN} INTEGER,
            {schema.COL_HABIT_ARCHIVED} INTEGER,
            {schema.COL_HABIT_TYPE} INTEGER
        )
    ''')
    conn.execute(f'''
        CREATE TABLE {schema.TABLE_REPETITIONS} (
            {schema.COL_REPETITION_ID} INTEGER PRIMARY KEY,
            {schema.COL_REPETITION_HABIT_ID} INTEGER,
            {schema.COL_REPETITION_TIMESTAMP} INTEGER,
            {schema.COL_REPETITION_VALUE} INTEGER
        )
    ''')
    conn.commit()
    return conn


def create_synthetic_db_without_pk(path):
    """Variante SIN PRIMARY KEY en Habits.id, exclusivamente para poder
    insertar deliberadamente dos filas con el mismo id y ejercitar la
    deteccion de IDs duplicados. Una base real de Loop jamas tendria
    esto (su propio esquema SI tiene PRIMARY KEY); es un fixture de
    dato corrupto/malformado a proposito, no una suposicion de schema."""
    conn = sqlite3.connect(path)
    conn.execute(f'''
        CREATE TABLE {schema.TABLE_HABITS} (
            {schema.COL_HABIT_ID} INTEGER,
            {schema.COL_HABIT_NAME} TEXT,
            {schema.COL_HABIT_FREQ_NUM} INTEGER,
            {schema.COL_HABIT_FREQ_DEN} INTEGER,
            {schema.COL_HABIT_ARCHIVED} INTEGER,
            {schema.COL_HABIT_TYPE} INTEGER
        )
    ''')
    conn.execute(f'''
        CREATE TABLE {schema.TABLE_REPETITIONS} (
            {schema.COL_REPETITION_ID} INTEGER PRIMARY KEY,
            {schema.COL_REPETITION_HABIT_ID} INTEGER,
            {schema.COL_REPETITION_TIMESTAMP} INTEGER,
            {schema.COL_REPETITION_VALUE} INTEGER
        )
    ''')
    conn.commit()
    return conn


def insert_habit(conn, habit_id, name, freq_num, freq_den, archived=0, habit_type=0):
    conn.execute(
        f'INSERT INTO {schema.TABLE_HABITS} '
        f'({schema.COL_HABIT_ID}, {schema.COL_HABIT_NAME}, {schema.COL_HABIT_FREQ_NUM}, '
        f'{schema.COL_HABIT_FREQ_DEN}, {schema.COL_HABIT_ARCHIVED}, {schema.COL_HABIT_TYPE}) '
        'VALUES (?, ?, ?, ?, ?, ?)',
        (habit_id, name, freq_num, freq_den, archived, habit_type),
    )
    conn.commit()


def insert_repetition(conn, habit_id, timestamp_ms, value=None):
    if value is None:
        value = schema.VALUE_COMPLETED
    conn.execute(
        f'INSERT INTO {schema.TABLE_REPETITIONS} '
        f'({schema.COL_REPETITION_HABIT_ID}, {schema.COL_REPETITION_TIMESTAMP}, {schema.COL_REPETITION_VALUE}) '
        'VALUES (?, ?, ?)',
        (habit_id, timestamp_ms, value),
    )
    conn.commit()


def local_ms(dt_naive):
    """Convierte un datetime "naive" interpretado como hora LOCAL a
    milisegundos UTC desde epoch -- la inversa exacta de lo que hace
    timestamp_to_local_date() en el conversor, para poder construir
    fixtures deterministas de limites horarios."""
    return int(dt_naive.astimezone().timestamp() * 1000)


# ---------------------------------------------------------------------
# Fixtures con la FORMA de columnas confirmada en Gate B-2 (user_version
# 25): Habits agrega target_type, target_value, unit; Repetitions agrega
# notes. SOLO se confirmaron nombres y tipos de columna. El significado
# de target_type, la escala de target_value/Repetitions.value, las
# unidades y los valores especiales siguen SIN RESOLVER: los valores
# que usan los tests son opacos y sinteticos, nunca una interpretacion.
# ---------------------------------------------------------------------
def create_synthetic_db_v25_shape(path):
    conn = sqlite3.connect(path)
    conn.execute(f'''
        CREATE TABLE {schema.TABLE_HABITS} (
            {schema.COL_HABIT_ID} INTEGER PRIMARY KEY,
            {schema.COL_HABIT_ARCHIVED} INTEGER,
            color INTEGER,
            description TEXT,
            {schema.COL_HABIT_FREQ_DEN} INTEGER,
            {schema.COL_HABIT_FREQ_NUM} INTEGER,
            highlight INTEGER,
            {schema.COL_HABIT_NAME} TEXT,
            position INTEGER,
            reminder_hour INTEGER,
            reminder_min INTEGER,
            reminder_days INTEGER,
            {schema.COL_HABIT_TYPE} INTEGER,
            target_type INTEGER,
            target_value REAL,
            unit TEXT,
            question TEXT,
            uuid TEXT
        )
    ''')
    conn.execute(f'''
        CREATE TABLE {schema.TABLE_REPETITIONS} (
            {schema.COL_REPETITION_ID} INTEGER PRIMARY KEY,
            {schema.COL_REPETITION_HABIT_ID} INTEGER,
            {schema.COL_REPETITION_TIMESTAMP} INTEGER,
            {schema.COL_REPETITION_VALUE} INTEGER,
            notes TEXT
        )
    ''')
    conn.commit()
    return conn


def insert_habit_v25(conn, habit_id, name, freq_num, freq_den, habit_type=0,
                     target_type=0, target_value=0.0, unit='', archived=0):
    conn.execute(
        f'INSERT INTO {schema.TABLE_HABITS} '
        f'({schema.COL_HABIT_ID}, {schema.COL_HABIT_NAME}, {schema.COL_HABIT_FREQ_NUM}, '
        f'{schema.COL_HABIT_FREQ_DEN}, {schema.COL_HABIT_ARCHIVED}, {schema.COL_HABIT_TYPE}, '
        'target_type, target_value, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        (habit_id, name, freq_num, freq_den, archived, habit_type,
         target_type, target_value, unit),
    )
    conn.commit()
