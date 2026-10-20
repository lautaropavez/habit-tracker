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
import sqlite3
import subprocess
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
        self.assertIn(converter.CODE_UNSUPPORTED_FREQUENCY, ctx.exception.problems[0])
        self.assertIn('habit_id=1', ctx.exception.problems[0])

    def test_unsupported_freq_count_out_of_range(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Demasiado', 31, 7)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertIn(converter.CODE_UNSUPPORTED_FREQUENCY, ctx.exception.problems[0])


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
        self.assertTrue(any(converter.CODE_DUPLICATE_GENERATED_ID in p for p in ctx.exception.problems))


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
        self.assertIn(converter.CODE_NAME_CONTROL_CHARS, ctx.exception.problems[0])

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
        self.assertTrue(any(converter.CODE_FUTURE_COMPLETION in p for p in ctx.exception.problems))


class UnsupportedCategoryTests(TempDbTestCase):
    def test_archived_habit_unsupported(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Viejo habito', 1, 1, archived=1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertTrue(any(converter.CODE_ARCHIVED_HABIT in p for p in ctx.exception.problems))

    def test_quantitative_habit_unsupported(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Tomar agua', 1, 1, habit_type=1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertTrue(any(converter.CODE_UNSUPPORTED_QUANTITATIVE in p for p in ctx.exception.problems))


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
        self.assertIn(converter.CODE_ARCHIVED_HABIT, joined)
        self.assertIn(converter.CODE_UNSUPPORTED_FREQUENCY, joined)


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


class PrivacyDiagnosticsTests(TempDbTestCase):
    """PRIV-2: ningun mensaje de error/diagnostico (ni en convert() ni en
    la salida de la CLI) debe contener el nombre real del habito ni
    fechas/timestamps crudos. Usa un nombre sintetico claramente
    identificable para poder detectar una fuga con un simple assertNotIn."""

    SENTINEL_NAME = 'SENTINEL_PRIVATE_NAME_DO_NOT_LEAK_7f3a'

    def test_unsupported_frequency_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 11, self.SENTINEL_NAME, 1, 2)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_UNSUPPORTED_FREQUENCY, joined)
        self.assertIn('habit_id=11', joined)

    def test_archived_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 12, self.SENTINEL_NAME, 1, 1, archived=1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_ARCHIVED_HABIT, joined)
        self.assertIn('habit_id=12', joined)

    def test_quantitative_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 13, self.SENTINEL_NAME, 1, 1, habit_type=schema.HABIT_TYPE_QUANTITATIVE)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_UNSUPPORTED_QUANTITATIVE, joined)
        self.assertIn('habit_id=13', joined)

    def test_control_chars_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 14, self.SENTINEL_NAME + '\x07', 1, 1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_NAME_CONTROL_CHARS, joined)

    def test_future_completion_does_not_leak_name_or_date(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 15, self.SENTINEL_NAME, 1, 1)
        future_ms = fixtures.local_ms(datetime(2099, 7, 4, 12, 0, 0))
        fixtures.insert_repetition(conn, 15, future_ms)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-01-01')
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertNotIn('2099', joined)
        self.assertIn(converter.CODE_FUTURE_COMPLETION, joined)

    def test_cli_abort_stderr_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 16, self.SENTINEL_NAME, 1, 1, archived=1)
        conn.close()

        with redirect_stderr(io.StringIO()) as err:
            rc = converter.main(['--input', self.db_path, '--output', self.out_path])

        self.assertEqual(rc, 1)
        self.assertFalse(os.path.exists(self.out_path))
        self.assertNotIn(self.SENTINEL_NAME, err.getvalue())
        self.assertIn(converter.CODE_ARCHIVED_HABIT, err.getvalue())

    def test_cli_error_messages_use_basename_not_full_path(self):
        """Las rutas de entrada/salida en los mensajes de error de la CLI
        no deben incluir el directorio completo (puede contener datos
        personales, ej. el nombre de usuario del sistema)."""
        missing_input = os.path.join(self._tmpdir.name, 'no-existe.db')
        with redirect_stderr(io.StringIO()) as err:
            rc = converter.main(['--input', missing_input, '--output', self.out_path])
        self.assertEqual(rc, 2)
        self.assertNotIn(self._tmpdir.name, err.getvalue())
        self.assertIn('no-existe.db', err.getvalue())

    def test_cli_already_exists_error_does_not_leak_full_output_path(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        conn.close()
        with open(self.out_path, 'w', encoding='utf-8') as f:
            f.write('{}')

        with redirect_stderr(io.StringIO()) as err:
            rc = converter.main(['--input', self.db_path, '--output', self.out_path])

        self.assertEqual(rc, 2)
        self.assertNotIn(self._tmpdir.name, err.getvalue())

    def test_cli_invalid_sqlite_input_does_not_leak_path_or_raw_exception(self):
        """Un archivo que existe pero no es un SQLite valido: sqlite3
        abre el file handle sin error (open_readonly no lo detecta) y
        falla recien al consultarlo dentro de convert(); ese fallo debe
        quedar sanitizado por el handler generico de main(), nunca como
        traceback ni mensaje crudo con la ruta completa."""
        not_a_db = os.path.join(self._tmpdir.name, 'not-a-database.db')
        with open(not_a_db, 'w', encoding='utf-8') as f:
            f.write('esto no es un sqlite valido')

        with redirect_stderr(io.StringIO()) as err:
            rc = converter.main(['--input', not_a_db, '--output', self.out_path])

        self.assertEqual(rc, 2)
        stderr_value = err.getvalue()
        self.assertNotIn(self._tmpdir.name, stderr_value)
        self.assertNotIn('not-a-database.db', stderr_value)
        self.assertNotIn('Traceback', stderr_value)
        self.assertIn('fallo inesperado', stderr_value)

    def test_null_timestamp_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 17, self.SENTINEL_NAME, 1, 1)
        conn.execute(
            f'INSERT INTO {schema.TABLE_REPETITIONS} '
            f'({schema.COL_REPETITION_HABIT_ID}, {schema.COL_REPETITION_TIMESTAMP}, {schema.COL_REPETITION_VALUE}) '
            'VALUES (?, ?, ?)',
            (17, None, schema.VALUE_COMPLETED),
        )
        conn.commit()
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_NULL_TIMESTAMP, joined)

    def test_invalid_name_length_does_not_leak_name(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 18, self.SENTINEL_NAME * 2000, 1, 1)  # excede NAME_MAX_CODEPOINTS
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_INVALID_NAME_LENGTH, joined)

    def test_non_integer_habit_id_is_not_reflected_raw(self):
        """Fila corrupta/malformada con id de texto (SQLite es de
        tipado dinamico): debe rechazarse explicitamente como
        LOOP_INVALID_HABIT_ID *antes* de llegar al chequeo de
        archivado -- nunca se reflejo el valor crudo ni se trata con
        str()."""
        conn = self.make_db(without_pk=True)
        fixtures.insert_habit(conn, self.SENTINEL_NAME, 'Cualquiera', 1, 1, archived=1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_INVALID_LOOP_ID, joined)
        self.assertIn('<non-numeric>', joined)

    def test_null_habit_id_is_rejected_and_not_reflected_raw(self):
        """Un habit_id NULL (columna sin NOT NULL, fila corrupta) debe
        rechazarse igual que uno de texto -- nunca tratarse como caso
        especial ni convertirse implicitamente a 'None' via str()."""
        conn = self.make_db(without_pk=True)
        fixtures.insert_habit(conn, None, self.SENTINEL_NAME, 1, 1)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_INVALID_LOOP_ID, joined)
        self.assertIn('<non-numeric>', joined)

    def test_non_integer_frequency_does_not_crash_and_is_not_reflected_raw(self):
        """freq_num no entero no debe escapar como TypeError (perdiendo
        la lista completa de problemas) ni reflejarse crudo."""
        conn = self.make_db()
        fixtures.insert_habit(conn, 19, 'Valido', 1, 1)  # para confirmar que se sigue reportando junto al otro
        conn.execute(
            f'INSERT INTO {schema.TABLE_HABITS} '
            f'({schema.COL_HABIT_ID}, {schema.COL_HABIT_NAME}, {schema.COL_HABIT_FREQ_NUM}, '
            f'{schema.COL_HABIT_FREQ_DEN}, {schema.COL_HABIT_ARCHIVED}, {schema.COL_HABIT_TYPE}) '
            'VALUES (?, ?, ?, ?, ?, ?)',
            (20, self.SENTINEL_NAME, self.SENTINEL_NAME, 7, 0, 0),
        )
        conn.commit()
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertNotIn(self.SENTINEL_NAME, joined)
        self.assertIn(converter.CODE_UNSUPPORTED_FREQUENCY, joined)
        self.assertIn('habit_id=20', joined)

    def test_cli_unrecognized_argument_does_not_leak_raw_token(self):
        """argparse por defecto refleja los tokens crudos recibidos en su
        mensaje de error; si el usuario olvida comillas en una ruta con
        espacios, un fragmento de esa ruta (con datos personales, ej. el
        nombre de usuario) podria terminar en stderr."""
        with redirect_stderr(io.StringIO()) as err:
            with self.assertRaises(SystemExit) as ctx:
                converter.main([
                    '--input', self.db_path,
                    '--output', self.out_path,
                    '--bogus', f'C:\\Users\\{self.SENTINEL_NAME}\\loop.db',
                ])
        self.assertEqual(ctx.exception.code, 2)
        self.assertNotIn(self.SENTINEL_NAME, err.getvalue())


class GitignoreTests(unittest.TestCase):
    """Verifica, contra el .gitignore real del repo (via `git
    check-ignore`, solo lectura), que el directorio privado de Loop y
    los auxiliares de SQLite quedan ignorados, y que los archivos
    legitimos del proyecto siguen siendo visibles para Git."""

    REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))

    def _is_ignored(self, relative_path):
        """0 = ignorado, 1 = no ignorado; cualquier otro codigo (ej. 128,
        "not a git repository") es un fallo del propio chequeo y debe
        hacer fallar el test en vez de leerse como "no ignorado" en
        silencio. --no-index evalua solo el patron, independientemente
        de si el archivo ya esta trackeado (un archivo trackeado nunca
        se reporta como ignorado sin este flag, sin importar el patron)."""
        result = subprocess.run(
            ['git', 'check-ignore', '--quiet', '--no-index', relative_path],
            cwd=self.REPO_ROOT,
        )
        if result.returncode not in (0, 1):
            self.fail(f'git check-ignore devolvio un codigo inesperado ({result.returncode}) para {relative_path!r}')
        return result.returncode == 0

    def test_private_loop_directory_is_ignored(self):
        self.assertTrue(self._is_ignored('.loop-private/anything.txt'))
        self.assertTrue(self._is_ignored('.loop-private/OUTPUT/converted.json'))
        self.assertTrue(self._is_ignored('.loop-private/ORIGINAL/real.db'))

    def test_sqlite_wal_auxiliary_files_are_ignored(self):
        for name in ('x.db-wal', 'x.db-shm', 'x.db-journal',
                     'x.sqlite-wal', 'x.sqlite-shm', 'x.sqlite-journal',
                     'x.sqlite3-wal', 'x.sqlite3-shm', 'x.sqlite3-journal'):
            self.assertTrue(self._is_ignored(name), name)

    def test_loop_convert_temp_files_are_ignored(self):
        """Temporal atomico de write_backup_atomic() (tools/loop_habits_
        to_json.py): la regla '.loop_convert_*' ya esta aplicada a mano
        en .gitignore (ver docs/SECURITY.md, seccion 6) y este test
        confirma que git la reconoce."""
        self.assertTrue(self._is_ignored('.loop_convert_abc123'))
        self.assertTrue(self._is_ignored('some/dir/.loop_convert_abc123'))

    def test_legitimate_project_files_remain_visible(self):
        for name in ('js/app.js', 'css/styles.css', 'index.html',
                     'docs/ROADMAP.md', 'tools/loop_habits_to_json.py',
                     'tests/loop_converter/test_converter.py'):
            self.assertFalse(self._is_ignored(name), name)


class LoopIdValidationTests(unittest.TestCase):
    """is_valid_loop_id() en aislamiento. SQLite nunca puede devolver un
    bool real desde una columna INTEGER (lo normaliza a 0/1 como int),
    asi que la exclusion de bool solo puede verificarse llamando la
    funcion directamente, no insertando una fila real."""

    def test_accepts_plain_int(self):
        self.assertTrue(converter.is_valid_loop_id(5))
        self.assertTrue(converter.is_valid_loop_id(0))
        self.assertTrue(converter.is_valid_loop_id(-1))

    def test_rejects_bool(self):
        self.assertFalse(converter.is_valid_loop_id(True))
        self.assertFalse(converter.is_valid_loop_id(False))

    def test_rejects_none_and_text(self):
        self.assertFalse(converter.is_valid_loop_id(None))
        self.assertFalse(converter.is_valid_loop_id('7'))


class HabitTypeValidationTests(unittest.TestCase):
    """is_valid_habit_type() en aislamiento, igual que
    LoopIdValidationTests: la exclusion de bool solo puede verificarse
    llamando la funcion directamente."""

    def test_accepts_known_types(self):
        self.assertTrue(converter.is_valid_habit_type(schema.HABIT_TYPE_BOOLEAN))
        self.assertTrue(converter.is_valid_habit_type(schema.HABIT_TYPE_QUANTITATIVE))

    def test_rejects_bool(self):
        self.assertFalse(converter.is_valid_habit_type(True))
        self.assertFalse(converter.is_valid_habit_type(False))

    def test_rejects_none_text_and_out_of_range_int(self):
        self.assertFalse(converter.is_valid_habit_type(None))
        self.assertFalse(converter.is_valid_habit_type('0'))
        self.assertFalse(converter.is_valid_habit_type(5))
        self.assertFalse(converter.is_valid_habit_type(-1))


class RepetitionValueValidationTests(unittest.TestCase):
    """is_valid_repetition_value() en aislamiento, mismo criterio que
    HabitTypeValidationTests/LoopIdValidationTests."""

    def test_accepts_all_known_values(self):
        for value in (
            schema.VALUE_NO, schema.VALUE_YES_AUTO, schema.VALUE_YES_MANUAL,
            schema.VALUE_SKIP, schema.VALUE_UNKNOWN,
        ):
            self.assertTrue(converter.is_valid_repetition_value(value))

    def test_rejects_bool(self):
        self.assertFalse(converter.is_valid_repetition_value(True))
        self.assertFalse(converter.is_valid_repetition_value(False))

    def test_rejects_none_text_and_out_of_range_int(self):
        self.assertFalse(converter.is_valid_repetition_value(None))
        self.assertFalse(converter.is_valid_repetition_value('yes'))
        self.assertFalse(converter.is_valid_repetition_value(42))


class HabitTypeConversionTests(TempDbTestCase):
    """Cobertura de integracion: un Habits.type invalido debe abortar
    con CODE_INVALID_HABIT_TYPE, nunca confundirse con
    CODE_UNSUPPORTED_QUANTITATIVE (que es solo para type=1 valido)."""

    def test_null_habit_type_is_fatal_and_distinct_from_quantitative(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1, habit_type=None)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertIn(converter.CODE_INVALID_HABIT_TYPE, joined)
        self.assertNotIn(converter.CODE_UNSUPPORTED_QUANTITATIVE, joined)

    def test_text_habit_type_is_fatal(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1, habit_type='boolean')
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertTrue(any(converter.CODE_INVALID_HABIT_TYPE in p for p in ctx.exception.problems))

    def test_out_of_range_habit_type_is_fatal_and_distinct_from_quantitative(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1, habit_type=5)
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        joined = ' | '.join(ctx.exception.problems)
        self.assertIn(converter.CODE_INVALID_HABIT_TYPE, joined)
        self.assertNotIn(converter.CODE_UNSUPPORTED_QUANTITATIVE, joined)


class RepetitionValueConversionTests(TempDbTestCase):
    """Cobertura de integracion de los 5 valores conocidos de
    Repetitions.value y de los casos invalidos -- ninguno debe tratarse
    en silencio como 'no completado' salvo VALUE_NO, que es el unico
    valor conocido con ese significado explicito."""

    def test_yes_manual_and_yes_auto_both_count_as_completed(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value=schema.VALUE_YES_MANUAL,
        )
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 6, 8, 0, 0)), value=schema.VALUE_YES_AUTO,
        )
        data = converter.convert(conn, today_local_str='2026-06-01')
        self.assertTrue(data['completions']['2026-01-05']['loop-1'])
        self.assertTrue(data['completions']['2026-01-06']['loop-1'])

    def test_no_value_is_not_completed_and_not_an_error(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value=schema.VALUE_NO,
        )
        data = converter.convert(conn, today_local_str='2026-06-01')
        self.assertEqual(data['completions'], {})
        self.assertEqual(len(data['habits']), 1)

    def test_skip_value_aborts_instead_of_silently_not_completed(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value=schema.VALUE_SKIP,
        )
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-06-01')
        self.assertTrue(any(converter.CODE_SPECIAL_REPETITION_VALUE in p for p in ctx.exception.problems))

    def test_unknown_value_aborts_instead_of_silently_not_completed(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value=schema.VALUE_UNKNOWN,
        )
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-06-01')
        self.assertTrue(any(converter.CODE_SPECIAL_REPETITION_VALUE in p for p in ctx.exception.problems))

    def test_null_value_is_fatal(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        conn.execute(
            f'INSERT INTO {schema.TABLE_REPETITIONS} '
            f'({schema.COL_REPETITION_HABIT_ID}, {schema.COL_REPETITION_TIMESTAMP}, {schema.COL_REPETITION_VALUE}) '
            'VALUES (?, ?, ?)',
            (1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), None),
        )
        conn.commit()
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-06-01')
        self.assertTrue(any(converter.CODE_INVALID_REPETITION_VALUE in p for p in ctx.exception.problems))

    def test_text_value_is_fatal(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value='yes',
        )
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-06-01')
        self.assertTrue(any(converter.CODE_INVALID_REPETITION_VALUE in p for p in ctx.exception.problems))

    def test_out_of_range_value_is_fatal(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(
            conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value=42,
        )
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-06-01')
        self.assertTrue(any(converter.CODE_INVALID_REPETITION_VALUE in p for p in ctx.exception.problems))


class ArchivedAndSpecialStatesAreNeverSilentTests(TempDbTestCase):
    """Cobertura explicita del punto 5 del ticket: ni un habito
    archivado ni una repeticion en estado especial deben desaparecer
    del dataset sin reportarse -- siempre terminan en `problems`,
    nunca excluidos en silencio."""

    def test_archived_habit_with_skip_repetition_reports_both_problems(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Archivado', 1, 1, archived=1)
        fixtures.insert_habit(conn, 2, 'Con skip', 1, 1)
        fixtures.insert_repetition(
            conn, 2, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), value=schema.VALUE_SKIP,
        )
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn, today_local_str='2026-06-01')
        self.assertEqual(len(ctx.exception.problems), 2)
        joined = ' | '.join(ctx.exception.problems)
        self.assertIn(converter.CODE_ARCHIVED_HABIT, joined)
        self.assertIn(converter.CODE_SPECIAL_REPETITION_VALUE, joined)


class OrphanedRepetitionTests(TempDbTestCase):
    def test_orphaned_repetition_detected_and_aborts(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        conn.execute(
            f'INSERT INTO {schema.TABLE_REPETITIONS} '
            f'({schema.COL_REPETITION_HABIT_ID}, {schema.COL_REPETITION_TIMESTAMP}, {schema.COL_REPETITION_VALUE}) '
            'VALUES (?, ?, ?)',
            (99, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), schema.VALUE_COMPLETED),
        )
        conn.commit()
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertEqual(len(ctx.exception.problems), 1)
        self.assertIn(converter.CODE_ORPHANED_REPETITION, ctx.exception.problems[0])
        self.assertIn('habit_id=99', ctx.exception.problems[0])

    def test_matching_repetition_is_not_flagged_as_orphan(self):
        conn = self.make_db()
        fixtures.insert_habit(conn, 1, 'Valido', 1, 1)
        fixtures.insert_repetition(conn, 1, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)))
        data = converter.convert(conn, today_local_str='2026-06-01')
        self.assertEqual(len(data['habits']), 1)

    def test_invalid_habit_id_with_matching_repetition_is_not_also_flagged_as_orphan(self):
        """known_habit_ids se construye a partir de las filas crudas de
        Habits, sin filtrar por validez, antes de evaluar huerfanas: una
        repeticion que referencia el mismo id invalido (no entero) que
        su propio habito no debe contarse ademas como huerfana -- debe
        reportarse una sola vez, como LOOP_INVALID_HABIT_ID."""
        conn = self.make_db(without_pk=True)
        fixtures.insert_habit(conn, PrivacyDiagnosticsTests.SENTINEL_NAME, 'Cualquiera', 1, 1)
        conn.execute(
            f'INSERT INTO {schema.TABLE_REPETITIONS} '
            f'({schema.COL_REPETITION_HABIT_ID}, {schema.COL_REPETITION_TIMESTAMP}, {schema.COL_REPETITION_VALUE}) '
            'VALUES (?, ?, ?)',
            (PrivacyDiagnosticsTests.SENTINEL_NAME, fixtures.local_ms(datetime(2026, 1, 5, 8, 0, 0)), schema.VALUE_COMPLETED),
        )
        conn.commit()
        with self.assertRaises(converter.ConversionAborted) as ctx:
            converter.convert(conn)
        self.assertEqual(len(ctx.exception.problems), 1)
        joined = ' | '.join(ctx.exception.problems)
        self.assertIn(converter.CODE_INVALID_LOOP_ID, joined)
        self.assertNotIn(converter.CODE_ORPHANED_REPETITION, joined)
        self.assertNotIn(PrivacyDiagnosticsTests.SENTINEL_NAME, joined)


class ReadonlyUriTests(unittest.TestCase):
    """Construccion del URI file: de solo lectura, a nivel de funcion
    pura. '?' no se puede probar con un archivo real en este sistema
    operativo (caracter invalido en nombres de archivo de Windows);
    esta es la unica forma de ejercitar los tres caracteres de manera
    determinista en cualquier plataforma."""

    def test_reserved_characters_are_percent_encoded(self):
        uri = converter.build_readonly_uri('C:/fake/pa?th#with%chars/loop.db')
        self.assertIn('%3F', uri)
        self.assertIn('%23', uri)
        self.assertIn('%25', uri)
        self.assertTrue(uri.endswith('?mode=ro'))
        self.assertNotIn('pa?th', uri)
        self.assertNotIn('with#chars', uri)

    def test_windows_drive_and_separators_stay_readable(self):
        uri = converter.build_readonly_uri('C:\\Users\\example\\loop.db')
        self.assertIn('C:\\Users\\example\\loop.db', uri)


class ReadonlyUriRealFileTests(unittest.TestCase):
    """Round-trip real sobre un archivo cuyo nombre contiene '#' y '%'
    (caracteres validos en Windows, a diferencia de '?')."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.db_path = os.path.join(self._tmpdir.name, 'lo#op%db.db')
        self.out_path = os.path.join(self._tmpdir.name, 'out.json')

    def test_special_char_path_converts_successfully(self):
        conn = fixtures.create_synthetic_db(self.db_path)
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        conn.close()

        rc = converter.main(['--input', self.db_path, '--output', self.out_path])
        self.assertEqual(rc, 0)
        self.assertTrue(os.path.exists(self.out_path))

    def test_special_char_path_is_genuinely_readonly(self):
        conn = fixtures.create_synthetic_db(self.db_path)
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        conn.close()

        ro_conn = converter.open_readonly(self.db_path)
        self.addCleanup(ro_conn.close)
        with self.assertRaises(sqlite3.OperationalError):
            ro_conn.execute(
                f"INSERT INTO {schema.TABLE_HABITS} "
                f"({schema.COL_HABIT_ID}, {schema.COL_HABIT_NAME}, {schema.COL_HABIT_FREQ_NUM}, "
                f"{schema.COL_HABIT_FREQ_DEN}, {schema.COL_HABIT_ARCHIVED}, {schema.COL_HABIT_TYPE}) "
                "VALUES (99, 'x', 1, 1, 0, 0)"
            )


class WriteBackupAtomicDirectTests(unittest.TestCase):
    """Cubre directamente la rama FileExistsError de
    write_backup_atomic(). El camino via CLI (test_cli_does_not_
    overwrite_existing_output) nunca llega a ejercitarla de verdad: el
    chequeo temprano de main() ya corta antes de invocar esta funcion,
    asi que esa rama quedaba sin cobertura propia."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.out_path = os.path.join(self._tmpdir.name, 'out.json')

    def test_file_exists_error_does_not_overwrite_existing_output(self):
        original_content = '{"ya existia": true}'
        with open(self.out_path, 'w', encoding='utf-8') as f:
            f.write(original_content)

        with self.assertRaises(FileExistsError):
            converter.write_backup_atomic(self.out_path, {'schemaVersion': 1})

        with open(self.out_path, encoding='utf-8') as f:
            self.assertEqual(f.read(), original_content)


if __name__ == '__main__':
    unittest.main()
