"""
Suposiciones SINTETICAS sobre el esquema de Loop Habit Tracker (SQLite).

Ninguna de las constantes de este archivo esta verificada contra un
backup real de Loop. Son suposiciones basadas en conocimiento publico
general del esquema de Loop Habit Tracker, usadas EXCLUSIVAMENTE para
construir y probar el conversor contra fixtures sinteticos propios.

Antes de ejecutar este conversor contra un archivo .db real, cada una de
estas suposiciones debe reconciliarse explicitamente contra el esquema
real bajo un Gate B separado (ver docs/ROADMAP.md, seccion "Conversor
Loop -> backup JSON v1"). Ninguna funcion de este proyecto debe
"adivinar" un valor real a partir de estas suposiciones: si una de ellas
resulta incorrecta, el conversor debe fallar explicito, no producir un
resultado silenciosamente equivocado.
"""

# --- Tablas y columnas (PENDING_REAL_SCHEMA) ---------------------------

TABLE_HABITS = 'Habits'
TABLE_REPETITIONS = 'Repetitions'

COL_HABIT_ID = 'id'
COL_HABIT_NAME = 'name'
COL_HABIT_FREQ_NUM = 'freq_num'
COL_HABIT_FREQ_DEN = 'freq_den'
COL_HABIT_ARCHIVED = 'archived'
COL_HABIT_TYPE = 'type'

COL_REPETITION_ID = 'id'
COL_REPETITION_HABIT_ID = 'habit'
COL_REPETITION_TIMESTAMP = 'timestamp'
COL_REPETITION_VALUE = 'value'

# --- Codificaciones asumidas (PENDING_REAL_SCHEMA) ---------------------

# Unidad del timestamp de Repetitions: suposicion estandar de Android
# (milisegundos UTC desde epoch). No verificado contra un .db real.
TIMESTAMP_UNIT = 'milliseconds_utc'

# Valor de `value` que Loop usa para marcar una repeticion como
# completada manualmente. No verificado contra un .db real. Cualquier
# otro valor se trata como "no completado" (no genera una entrada true),
# nunca como un error en si mismo.
VALUE_COMPLETED = 2

# Valor de `type` que distingue un habito booleano (si/no) de uno
# cuantitativo/medible. Cualquier valor distinto de BOOLEAN se trata
# como cuantitativo -> UNSUPPORTED. No verificado contra un .db real.
HABIT_TYPE_BOOLEAN = 0

# --- Explicitamente NO implementado hasta Gate B -----------------------

# Columna de fecha de creacion "real" del habito en Loop, si existe.
# None = no se usa todavia; la prioridad A de createdAt (Gate A, seccion
# 7) queda sin efecto hasta que Gate B confirme que existe un campo asi
# y como se llama. El conversor nunca debe inventar este valor.
COL_HABIT_CREATED_AT_REAL = None

# Formula real de conversion de color (entero -> #RRGGBB) de Loop.
# Deliberadamente NO implementada en esta fase. Ver
# COLOR_SYNTHETIC_DEFAULT en loop_habits_to_json.py.
COLOR_REAL_MAPPING_IMPLEMENTED = False
