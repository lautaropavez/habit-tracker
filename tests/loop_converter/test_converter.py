"""Tests del conversor Loop -> Backup v1, 100% sobre datos sinteticos.

Llama exclusivamente a las funciones reales de tools/loop_habits_to_json.py
y tools/loop_schema.py -- no reimplementa su logica aca.

No usa Edge ni navegador. No ejecuta validateBackup() real todavia (eso
queda para la siguiente micro-posta). No abre ni referencia ningun .db
real.
"""
import io
import json
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from datetime import datetime, timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
import loop_habits_to_json as converter  # noqa: E402
import loop_schema as schema  # noqa: E402

import fixtures  # noqa: E402


def _today_local_str():
    return datetime.now().astimezone().strftime('%Y-%m-%d')


class TempDbTestCase(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.db_path = os.path.join(self._tmpdir.name, 'synthetic.db')
        self.out_path = os.path.join(self._tmpdir.name, 'out.json')

    def make_db(self, without_pk=False):
        """Crea la base sintetica y registra el cierre de la conexion ANTES
        de que se intente borrar el directorio temporal: en Windows, un
        archivo sqlite todavia abierto bloquea su propio borrado (a
        diferencia de POSIX), lo que rompia la limpieza del test, no al
        conversor en si."""
        creator = fixtures.create_synthetic_db_without_pk if without_pk else fixtures.create_synthetic_db
        conn = creator(self.db_path)
        self.addCleanup(conn.close)
        return conn


class FrequencyTests(TempDbTestCase):
    def test_daily_1_1(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        data = converter.convert(conn)
        self.assertEqual(len(data['habits']), 1)
        h = data['habits'][0]
        self.assertEqual(h['freq'], 'daily')
        self.assertEqual(h['freqCount'], 1)
        self.assertEqual(h['freqPeriod'], 'week')

    def test_n_over_7(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Gimnasio', 3, 7)
        data = converter.convert(conn)
        h = data['habits'][0]
        self.assertEqual(h['freq'], 'custom')
        self.assertEqual(h['freqCount'], 3)
        self.assertEqual(h['freqPeriod'], 'week')

    def test_unsupported_frequency(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Cada 2 dias', 1, 2)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertEqual(len(ctx.exception.problems), 1)
        self.assertIn('no soportada', ctx.exception.problems[0])
        self.assertIn('UNSUPPORTED', ctx.exception.problems[0])

    def test_unsupported_freq_count_out_of_range(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Demasiado', 31, 7)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertIn('UNSUPPORTED', ctx.exception.problems[0])


class IdTests(TempDbTestCase):
    def test_id_format(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 42, 'Leer', 1, 1)
        data = converter.convert(conn)
        self.assertEqual(data['habits'][0]['id'], 'loop-42')
        self.assertTrue(converter.is_valid_id_format(data['habits'][0]['id']))

    def test_duplicate_id_detected(self):
        conn = self.make_db(without_pk=True)
        fixtures.insert_habit(conn, 7, 'Primero', 1, 1)
        fixtures.insert_habit(conn, 7, 'Segundo', 1, 1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertTrue(any('duplicado' in p for p in ctx.exception.problems))


class NameTests(TempDbTestCase):
    def test_unicode_name_including_astral_emoji(self):
        conn = self.make_db()
        name = 'Café ☕ y 🧘🏽 meditación'  # incluye emoji con modificador de tono (astral)
        fixtures.insert_habit(conn, 1, name, 1, 1)
        data = converter.convert(conn)
        self.assertEqual(data['habits'][0]['name'], name)

    def test_control_chars_rejected(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Malo\x07control', 1, 1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertIn('caracteres de control', ctx.exception.problems[0])

    def test_empty_name_rejected(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, '', 1, 1)
        with self.assertRaises(converter.ConversionAborted):
            converter.convert(conn)


class CreatedAtTests(TempDbTestCase):
    def test_created_at_from_first_completion(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Correr', 1, 1)
        fixtures.insert_repetition(conn, 1, fixtures.local_ms(datetime(2025, 3, 10, 8, 0, 0)))
        fixtures.insert_repetition(conn, 1, fixtures.local_ms(datetime(2025, 3, 5, 8, 0, 0)))
        data = converter.convert(conn, today_local_str='2026-01-01')
        self.assertEqual(data['habits'][0]['createdAt'], '2025-03-05')

    def test_created_at_fallback_without_history(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Sin historial', 1, 1)
        data = converter.convert(conn, today_local_str='2026-05-20')
        self.assertEqual(data['habits'][0]['createdAt'], '2026-05-20')


class DateBoundaryTests(unittest.TestCase):
    def test_not_utc_accidental_near_midnight(self):
        # 23:30 hora local del 2026-01-31 debe seguir siendo 2026-01-31
        # localmente, aunque en UTC ya sea otro dia para husos negativos.
        dt_local = datetime(2026, 1, 31, 23, 30, 0)
        ms = fixtures.local_ms(dt_local)
        expected = dt_local.astimezone().strftime('%Y-%m-%d')
        self.assertEqual(converter.timestamp_to_local_date(ms), expected)
        self.assertEqual(converter.timestamp_to_local_date(ms), '2026-01-31')

    def test_year_boundary(self):
        dt_local = datetime(2025, 12, 31, 23, 59, 0)
        ms = fixtures.local_ms(dt_local)
        self.assertEqual(converter.timestamp_to_local_date(ms), '2025-12-31')

    def test_month_boundary(self):
        dt_local = datetime(2026, 1, 31, 12, 0, 0)
        ms = fixtures.local_ms(dt_local)
        self.assertEqual(converter.timestamp_to_local_date(ms), '2026-01-31')

    def test_leap_year_feb_29(self):
        dt_local = datetime(2028, 2, 29, 12, 0, 0)  # 2028 es bisiesto
        ms = fixtures.local_ms(dt_local)
        self.assertEqual(converter.timestamp_to_local_date(ms), '2028-02-29')


class FutureCompletionTests(TempDbTestCase):
    def test_future_completion_is_fatal(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Futuro', 1, 1)
        future_ms = fixtures.local_ms(datetime(2099, 1, 1, 12, 0, 0))
        fixtures.insert_repetition(conn, 1, future_ms)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-01-01')
        self.assertTrue(any('futura' in p for p in ctx.exception.problems))


class UnsupportedCategoryTests(TempDbTestCase):
    def test_archived_habit_unsupported(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Viejo habito', 1, 1, archived=1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertTrue(any('archivado' in p for p in ctx.exception.problems))

    def test_quantitative_habit_unsupported(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Tomar agua', 1, 1, habit_type=1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertTrue(any('cuantitativo' in p for p in ctx.exception.problems))


class MultipleProblemsTests(TempDbTestCase):
    def test_multiple_problems_all_reported(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Archivado', 1, 1, archived=1)
        fixtures.insert_habit(conn, 2, 'Frecuencia rara', 1, 2)
        fixtures.insert_habit(conn, 3, 'Valido', 1, 1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertEqual(len(ctx.exception.problems), 2)
        joined = ' | '.join(ctx.exception.problems)
        self.assertIn('archivado', joined)
        self.assertIn('UNSUPPORTED', joined)


class AtomicityTests(TempDbTestCase):
    def test_no_output_file_on_abort_via_cli(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Archivado', 1, 1, archived=1)
        conn.close()

        with redirect_stderr(io.StringIO()) as err:
            rc = converter.main(['--input', self.db_path, '--output', self.out_path])

        self.assertEqual(rc, 1)
        self.assertFalse(os.path.exists(self.out_path))
        self.assertIn('CONVERSION ABORTADA', err.getvalue())

    def test_no_temp_file_leftover_on_abort(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Archivado', 1, 1, archived=1)
        conn.close()

        with redirect_stderr(io.StringIO()):
            converter.main(['--input', self.db_path, '--output', self.out_path])

        leftovers = [f for f in os.listdir(os.path.dirname(self.out_path)) if f.startswith('.loop_convert_')]
        self.assertEqual(leftovers, [])


class ValidDatasetShapeTests(TempDbTestCase):
    def test_valid_dataset_produces_backup_v1_shape(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        fixtures.insert_habit(conn, 2, 'Gimnasio', 3, 7)
        fixtures.insert_repetition(conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)))
        fixtures.insert_repetition(conn, 1, fixtures.local_ms(datetime(2026, 1, 6, 8, 0, 0)))
        fixtures.insert_repetition(conn, 2, fixtures.local_ms(datetime(2026, 1, 7, 8, 0, 0)), value=0)  # no completado

        data = converter.convert(conn, today_local_str='2026-06-01')

        self.assertEqual(sorted(data.keys()), sorted(['schemaVersion', 'exportedAt', 'habits', 'completions']))
        self.assertEqual(data['schemaVersion'], 1)
        self.assertEqual(len(data['habits']), 2)
        for h in data['habits']:
            self.assertEqual(
                sorted(h.keys()),
                sorted(['id', 'name', 'icon', 'color', 'freq', 'freqCount', 'freqPeriod', 'createdAt']),
            )
            self.assertEqual(h['icon'], '\U0001F4DA')
            self.assertEqual(h['color'], '#4ECDC4')
        # El habito 2 tuvo una sola repeticion y no estaba completada (value=0):
        # no debe generar ninguna entrada de completions.
        habit2_id = next(h['id'] for h in data['habits'] if h['name'] == 'Gimnasio')
        for date_entries in data['completions'].values():
            self.assertNotIn(habit2_id, date_entries)
        # json.dumps no debe fallar (round-trip real, no solo construccion en memoria).
        json.dumps(data)

    def test_empty_dataset_is_valid(self):
        conn = self.make_db()
        data = converter.convert(conn)
        self.assertEqual(data['habits'], [])
        self.assertEqual(data['completions'], {})


class CliOutputTests(TempDbTestCase):
    def test_cli_success_writes_file(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        conn.close()

        rc = converter.main(['--input', self.db_path, '--output', self.out_path])
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(self.out_path))
        with open(self.out_path, encoding='utf-8') as f:
            data = json.load(f)
        self.assertEqual(data['schemaVersion'], 1)

    def test_cli_does_not_overwrite_existing_output(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        conn.close()

        original_content = '{"ya existia": true}'
        with open(self.out_path, 'w', encoding='utf-8') as f:
            f.write(original_content)

        with redirect_stderr(io.StringIO()) as err:
            rc = converter.main(['--input', self.db_path, '--output', self.out_path])

        self.assertEqual(rc, 2)
        self.assertIn('ya existe', err.getvalue())
        with open(self.out_path, encoding='utf-8') as f:
            self.assertEqual(f.read(), original_content)


if __name__ == '__main__':
    unittest.main()
