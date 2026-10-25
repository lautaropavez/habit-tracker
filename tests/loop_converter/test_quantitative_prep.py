"""Preparacion del conversor Loop -> Backup v2 (hábitos cuantitativos).

100% sintetico. Dos grupos:

1. Tests ACTIVOS: fijan que, mientras escala, unidades, target_type y
   valores especiales sigan sin resolver, el conversor NO convierte
   ningun hábito cuantitativo (fail-closed), no filtra unit/target en los
   diagnosticos y sigue convirtiendo los booleanos igual sobre un esquema
   con la forma de columnas de user_version 25.
2. Tests PENDIENTES (skip): especifican lo que habra que probar cuando
   haya evidencia. No implementan ninguna interpretacion numerica.
"""
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
import loop_habits_to_json as converter  # noqa: E402

import fixtures  # noqa: E402

# Marcadores distintivos: si alguno aparece en un diagnostico, hubo fuga.
UNIT_SENTINEL = 'UNIT_SENTINEL_XYZ'
NAME_SENTINEL = 'NAME_SENTINEL_XYZ'
TARGET_SENTINEL = 7777.5
DAY_MS = 86400 * 1000


class V25ShapeCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.db_path = os.path.join(self._tmp.name, 'synthetic_v25.db')
        self.out_path = os.path.join(self._tmp.name, 'out.json')
        self.conn = fixtures.create_synthetic_db_v25_shape(self.db_path)
        self.addCleanup(self.conn.close)

    def _joined_problems(self, ctx):
        return ' | '.join(ctx.exception.problems)


class ActiveGuardTests(V25ShapeCase):
    def test_boolean_habit_converts_on_v25_shape_ignoring_extra_columns(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Meditar', 1, 1, habit_type=0,
                                  target_type=0, target_value=0.0, unit='')
        fixtures.insert_repetition(self.conn, 1, fixtures.local_ms(
            __import__('datetime').datetime(2024, 3, 10, 12, 0)))
        data = converter.convert(self.conn, today_local_str='2024-12-31')
        self.assertEqual(len(data['habits']), 1)
        self.assertEqual(data['habits'][0]['id'], 'loop-1')
        self.assertEqual(data['completions'], {'2024-03-10': {'loop-1': True}})

    def test_quantitative_is_rejected_regardless_of_unit_target_or_values(self):
        for i, unit in enumerate(['', None, 'min', 'minutes', UNIT_SENTINEL], start=10):
            with self.subTest(unit=unit):
                fixtures.insert_habit_v25(self.conn, i, 'Q%d' % i, 1, 1, habit_type=1,
                                          target_type=1, target_value=TARGET_SENTINEL, unit=unit)
                fixtures.insert_repetition(self.conn, i, 1_700_000_000_000, value=5)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(self.conn, today_local_str='2099-12-31')
        problems = ctx.exception.problems
        self.assertEqual(len(problems), 5)
        self.assertTrue(all(converter.CODE_UNSUPPORTED_QUANTITATIVE in p for p in problems))

    def test_zero_negative_and_large_values_do_not_change_the_rejection(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Q', 1, 1, habit_type=1,
                                  target_type=0, target_value=30.0, unit='min')
        for v in (0, -1, 1, 30, 30000, 2_000_000_000):
            fixtures.insert_repetition(self.conn, 1, 1_700_000_000_000 + v, value=v)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(self.conn, today_local_str='2099-12-31')
        self.assertEqual(len(ctx.exception.problems), 1)
        self.assertIn(converter.CODE_UNSUPPORTED_QUANTITATIVE, ctx.exception.problems[0])

    def test_mixed_dataset_aborts_entirely_no_partial_boolean_output(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Bool', 1, 1, habit_type=0)
        fixtures.insert_repetition(self.conn, 1, 1_700_000_000_000)
        fixtures.insert_habit_v25(self.conn, 2, 'Quant', 1, 1, habit_type=1,
                                  target_type=1, target_value=60.0, unit='min')
        fixtures.insert_repetition(self.conn, 2, 1_700_000_000_000, value=45)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(self.conn, today_local_str='2099-12-31')
        joined = self._joined_problems(ctx)
        self.assertIn('habit_id=2', joined)
        self.assertNotIn('habit_id=1', joined)

    def test_main_exit_code_1_and_no_output_file_for_mixed_dataset(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Bool', 1, 1, habit_type=0)
        fixtures.insert_habit_v25(self.conn, 2, 'Quant', 1, 1, habit_type=1,
                                  target_type=1, target_value=60.0, unit='min')
        err = io.StringIO()
        with redirect_stderr(err):
            code = converter.main(['--input', self.db_path, '--output', self.out_path])
        self.assertEqual(code, 1)
        self.assertFalse(os.path.exists(self.out_path))
        self.assertEqual([f for f in os.listdir(self._tmp.name) if f.startswith('.loop_convert_')], [])

    def test_diagnostics_never_leak_unit_target_or_name(self):
        fixtures.insert_habit_v25(self.conn, 3, NAME_SENTINEL, 1, 1, habit_type=1,
                                  target_type=1, target_value=TARGET_SENTINEL, unit=UNIT_SENTINEL)
        fixtures.insert_repetition(self.conn, 3, 1_700_000_000_000, value=12345)
        err = io.StringIO()
        with redirect_stderr(err):
            converter.main(['--input', self.db_path, '--output', self.out_path])
        for text in (err.getvalue(),):
            for leaked in (UNIT_SENTINEL, NAME_SENTINEL, '7777', '12345'):
                self.assertNotIn(leaked, text)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(self.conn, today_local_str='2099-12-31')
        joined = self._joined_problems(ctx)
        for leaked in (UNIT_SENTINEL, NAME_SENTINEL, '7777', '12345'):
            self.assertNotIn(leaked, joined)

    def test_unknown_habit_type_remains_fatal_on_v25_shape(self):
        fixtures.insert_habit_v25(self.conn, 1, 'X', 1, 1, habit_type=2)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(self.conn, today_local_str='2099-12-31')
        self.assertIn(converter.CODE_INVALID_HABIT_TYPE, self._joined_problems(ctx))

    def test_quantitative_repetitions_never_reach_boolean_completions(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Bool', 1, 1, habit_type=0)
        fixtures.insert_habit_v25(self.conn, 2, 'Quant', 1, 1, habit_type=1, unit='min')
        fixtures.insert_repetition(self.conn, 2, 1_700_000_000_000, value=2)
        # el abort impide cualquier salida; ningun valor cuantitativo
        # (aunque coincida con VALUE_YES_MANUAL=2) se trata como "completado".
        with self.assertRaises(converter.ConversionAborted):
            converter.convert(self.conn, today_local_str='2099-12-31')


VALIDATOR_JS = os.path.join(os.path.dirname(__file__), 'validate_with_app.js')


def _validate_with_real_app(backup_dict):
    """Pasa el backup por el validateBackup() real de js/app.js (Node)."""
    proc = subprocess.run(
        ['node', VALIDATOR_JS], input=json.dumps(backup_dict),
        capture_output=True, text=True, encoding='utf-8', timeout=60,
    )
    if proc.returncode != 0:
        raise RuntimeError('validador JS fallo (rc=%d)' % proc.returncode)
    return json.loads(proc.stdout)


@unittest.skipIf(shutil.which('node') is None, 'node no disponible')
class RealValidatorCrossCheckTests(V25ShapeCase):
    def test_output_has_v2_shape_with_kind_boolean_and_empty_quantities(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Meditar', 1, 1)
        fixtures.insert_habit_v25(self.conn, 2, 'Gimnasio', 3, 7)
        fixtures.insert_repetition(self.conn, 1, 1_700_000_000_000)
        data = converter.convert(self.conn, today_local_str='2099-12-31')
        self.assertEqual(data['schemaVersion'], 2)
        self.assertEqual(data['quantities'], {})
        self.assertTrue(all(h['kind'] == 'boolean' for h in data['habits']))
        for h in data['habits']:
            self.assertNotIn('unit', h)
            self.assertNotIn('target', h)

    def test_boolean_output_is_accepted_by_real_validateBackup(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Meditar', 1, 1)
        fixtures.insert_habit_v25(self.conn, 2, 'Gimnasio', 3, 7)
        fixtures.insert_repetition(self.conn, 1, 1_700_000_000_000)
        fixtures.insert_repetition(self.conn, 2, 1_700_086_400_000)
        data = converter.convert(self.conn, today_local_str='2099-12-31')
        result = _validate_with_real_app(data)
        self.assertEqual(result, {'ok': True, 'error': None})

    def test_empty_dataset_is_accepted_by_real_validateBackup(self):
        data = converter.convert(self.conn, today_local_str='2099-12-31')
        self.assertEqual(_validate_with_real_app(data), {'ok': True, 'error': None})

    def test_validator_rejects_missing_kind_proving_the_check_is_real(self):
        fixtures.insert_habit_v25(self.conn, 1, 'Meditar', 1, 1)
        data = converter.convert(self.conn, today_local_str='2099-12-31')
        del data['habits'][0]['kind']
        self.assertFalse(_validate_with_real_app(data)['ok'])


class PendingSpecTests(unittest.TestCase):
    """Especificacion de lo que habra que probar. Cada test se activa solo
    cuando la incognita correspondiente tenga evidencia documentada."""

    @unittest.skip('PENDIENTE: factor de escala de target_value y Repetitions.value sin confirmar.')
    def test_scale_conversion_exact_integer_minutes(self):
        """Con factor confirmado: valor crudo -> actualMinutes entero exacto."""

    @unittest.skip('PENDIENTE: division no entera por el factor de escala; regla de redondeo no aprobada.')
    def test_non_integer_scaled_value_is_fatal_not_rounded(self):
        """Valor crudo no divisible por el factor -> fatal, nunca redondeo silencioso."""

    @unittest.skip('PENDIENTE: representacion de unidades en Loop sin confirmar.')
    def test_minutes_unit_maps_to_kind_quantitative_unit_minutes(self):
        """Unidad equivalente a minutos -> kind=quantitative, unit='minutes'."""

    @unittest.skip('PENDIENTE: unidades no-minutos sin regla aprobada.')
    def test_non_minutes_unit_is_fatal_never_approximated(self):
        """Cualquier otra unidad -> fatal con codigo propio."""

    @unittest.skip('PENDIENTE: significado de target_type (p. ej. "al menos"/"a lo sumo") sin confirmar.')
    def test_target_type_values_each_have_explicit_mapping_or_fatal(self):
        """Cada valor conocido de target_type: mapeo explicito o fatal; desconocido -> fatal."""

    @unittest.skip('PENDIENTE: escala de target_value y su relacion con target.minutes.')
    def test_target_value_maps_to_target_minutes_or_null(self):
        """target_value -> target={minutes:N} entero >=1, o null si corresponde; nunca inventado."""

    @unittest.skip('PENDIENTE: relacion objetivo <-> freq_num/freq_den sin definir (ROADMAP decision #3).')
    def test_target_with_non_daily_frequency_policy(self):
        """Politica para objetivos con frecuencia distinta de diaria."""

    @unittest.skip('PENDIENTE: significado de value=0 (registro explicito vs. relleno) sin confirmar.')
    def test_zero_value_semantics(self):
        """Cero -> actualMinutes:0 explicito o ausencia, segun evidencia."""

    @unittest.skip('PENDIENTE: valores especiales (omitido/skip) para medibles sin confirmar; v2 no tiene "skip".')
    def test_special_quantitative_values_have_dedicated_fatal_code(self):
        """Valor especial -> codigo fatal propio, nunca igualado a 0."""

    @unittest.skip('PENDIENTE: cota de sanidad 1440 min/dia sin decidir (ROADMAP decision #4).')
    def test_actual_minutes_above_daily_cap_policy(self):
        """Politica para actualMinutes > 1440."""


if __name__ == '__main__':
    unittest.main()
