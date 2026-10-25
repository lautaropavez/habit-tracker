"""
Conversion pura de un valor cuantitativo almacenado a minutos enteros.

NO esta integrada al flujo de conversion real (convert() sigue
rechazando todo habito cuantitativo). La escala de almacenamiento de
Repetitions.value de Loop NO esta confirmada: por eso `scale_factor` es
un parametro obligatorio, sin valor por defecto. Esta funcion no
interpreta ceros, objetivos ni estados especiales: solo aritmetica
exacta, y falla ante cualquier entrada invalida o conversion con
perdida de precision.

Los mensajes de error son codigos fijos; nunca reflejan los valores
recibidos.
"""

MAX_SAFE_INTEGER = 2**53 - 1  # mismo limite que Number.isSafeInteger en js/app.js

MINUTES_PER_UNIT = {
    'hs': 60,
}

CODE_INVALID_STORED_VALUE = 'QTY_INVALID_STORED_VALUE'
CODE_INVALID_SCALE_FACTOR = 'QTY_INVALID_SCALE_FACTOR'
CODE_UNSUPPORTED_UNIT = 'QTY_UNSUPPORTED_UNIT'
CODE_PRECISION_LOSS = 'QTY_PRECISION_LOSS'
CODE_RESULT_OUT_OF_RANGE = 'QTY_RESULT_OUT_OF_RANGE'


class QuantityConversionError(ValueError):
    """El unico argumento es siempre uno de los CODE_* de este modulo."""


def _is_exact_int(value):
    return type(value) is int


def stored_value_to_minutes(stored_value, scale_factor, unit):
    """minutos = stored_value * MINUTES_PER_UNIT[unit] / scale_factor.

    - stored_value: int exacto >= 0 (nunca bool, float, texto ni None).
    - scale_factor: int exacto >= 1, obligatorio, sin default.
    - unit: solo 'hs' (match exacto, sensible a mayusculas).
    - Si el resultado no es un entero exacto de minutos: error, nunca
      redondeo.
    - Si el resultado supera el entero seguro de JS: error.
    """
    if not _is_exact_int(stored_value) or stored_value < 0:
        raise QuantityConversionError(CODE_INVALID_STORED_VALUE)
    if not _is_exact_int(scale_factor) or scale_factor < 1:
        raise QuantityConversionError(CODE_INVALID_SCALE_FACTOR)
    if not isinstance(unit, str) or unit not in MINUTES_PER_UNIT:
        raise QuantityConversionError(CODE_UNSUPPORTED_UNIT)

    numerator = stored_value * MINUTES_PER_UNIT[unit]
    minutes, remainder = divmod(numerator, scale_factor)
    if remainder != 0:
        raise QuantityConversionError(CODE_PRECISION_LOSS)
    if minutes > MAX_SAFE_INTEGER:
        raise QuantityConversionError(CODE_RESULT_OUT_OF_RANGE)
    return minutes
