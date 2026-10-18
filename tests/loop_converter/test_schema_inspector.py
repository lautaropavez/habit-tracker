"""Tests del inspector de metadatos de Gate B-1, 100% sobre datos
sinteticos. Ningun test de este archivo abre, busca ni referencia un
backup real de Loop, ni crea ni modifica /.loop-private/.

Llama exclusivamente a las funciones reales de
tools/loop_schema_inspector.py -- no reimplementa su logica aca.

inspect() ya no acepta un `working_dir` del llamador: fija
internamente su raiz aprobada (_APPROVED_WORKING_DIR). Los tests que
necesitan un directorio sintetico lo logran redirigiendo ese atributo
de modulo con mock.patch.object -- nunca creando ni tocando la carpeta
real del repo.
"""
import os
import sqlite3
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
import loop_schema_inspector as inspector  # noqa: E402
import loop_schema as schema  # noqa: E402

import fixtures  # noqa: E402


class InspectorTestCase(unittest.TestCase):
    """Cada test trabaja dentro de un directorio temporal aislado que
    hace de raiz aprobada sintetica -- nunca el /.loop-private/WORKING/
    real del repo, que esta tarea tiene prohibido crear o poblar."""

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmpdir.cleanup)
        self.working_dir = os.path.join(self._tmpdir.name, 'WORKING')
        os.makedirs(self.working_dir)
        self.db_path = os.path.join(self.working_dir, 'copia.db')
        patcher = mock.patch.object(inspector, '_APPROVED_WORKING_DIR', self.working_dir)
        patcher.start()
        self.addCleanup(patcher.stop)

    def make_valid_db(self):
        conn = fixtures.create_synthetic_db(self.db_path)
        fixtures.insert_habit(conn, 1, 'Meditar', 1, 1)
        conn.close()


class ValidDatabaseTests(InspectorTestCase):
    def test_valid_synthetic_db_returns_structural_report(self):
        self.make_valid_db()
        result = inspector.inspect(self.db_path, 'BACKUP_A')

        self.assertEqual(result['backup'], 'BACKUP_A')
        self.assertIsInstance(result['sqliteUserVersion'], int)
        self.assertEqual(
            result['habitsColumnsPresent'],
            {name: True for name in inspector.EXPECTED_HABIT_COLUMNS},
        )
        self.assertEqual(
            result['repetitionsColumnsPresent'],
            {name: True for name in inspector.EXPECTED_REPETITION_COLUMNS},
        )
        # Las fixtures usan INTEGER PRIMARY KEY (rowid), que SQLite no
        # expone como un indice aparte en index_list: ambas tablas
        # deben reportar cero indices explicitos.
        self.assertEqual(result['habitsIndices'], [])
        self.assertEqual(result['repetitionsIndices'], [])
        self.assertEqual(result['repetitionsForeignKeys'], [])


class CanonicalWorkingDirTests(unittest.TestCase):
    """Verifica, sin tocar el filesystem real, que la raiz aprobada
    por defecto (sin ningun patch) esta fijada a .loop-private/WORKING
    dentro del repo -- y que un path bajo ORIGINAL/ se rechaza aunque
    el llamador no pueda pasar ningun working_dir alternativo."""

    def test_default_approved_working_dir_points_to_dot_loop_private_working(self):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(inspector.__file__)))
        expected = os.path.realpath(os.path.join(repo_root, '.loop-private', 'WORKING'))
        self.assertEqual(os.path.realpath(inspector._APPROVED_WORKING_DIR), expected)

    def test_a_path_under_original_is_rejected_with_no_way_to_override(self):
        repo_root = os.path.dirname(os.path.dirname(os.path.abspath(inspector.__file__)))
        original_path = os.path.join(repo_root, '.loop-private', 'ORIGINAL', 'backup.db')
        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(original_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_PATH_ESCAPES_WORKING)


class PathContainmentTests(InspectorTestCase):
    def test_path_outside_working_dir_is_rejected(self):
        outside_dir = tempfile.TemporaryDirectory()
        self.addCleanup(outside_dir.cleanup)
        outside_path = os.path.join(outside_dir.name, 'copia.db')
        conn = fixtures.create_synthetic_db(outside_path)
        conn.close()

        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(outside_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_PATH_ESCAPES_WORKING)

    def test_symlink_escaping_working_dir_is_rejected(self):
        outside_dir = tempfile.TemporaryDirectory()
        self.addCleanup(outside_dir.cleanup)
        real_outside_path = os.path.join(outside_dir.name, 'real.db')
        conn = fixtures.create_synthetic_db(real_outside_path)
        conn.close()

        symlink_path = os.path.join(self.working_dir, 'enlace.db')
        try:
            os.symlink(real_outside_path, symlink_path)
        except (OSError, NotImplementedError):
            self.skipTest('Este sistema no permite crear symlinks sin privilegios adicionales')

        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(symlink_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_PATH_ESCAPES_WORKING)

    def test_path_traversal_outside_working_dir_is_rejected(self):
        outside_dir = tempfile.TemporaryDirectory()
        self.addCleanup(outside_dir.cleanup)
        outside_path = os.path.join(outside_dir.name, 'otra.db')
        conn = fixtures.create_synthetic_db(outside_path)
        conn.close()

        traversal_path = os.path.join(self.working_dir, '..', os.path.basename(outside_dir.name), 'otra.db')
        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(traversal_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_PATH_ESCAPES_WORKING)


class SymlinkEscapeSimulationTests(InspectorTestCase):
    """Sustituto sintetico de la rama de symlink para maquinas sin
    privilegio para crearlos: simula, via mock de os.path.realpath,
    que la resolucion de `db_path` cae fuera de la raiz aprobada --
    sin necesidad de un symlink real ni de tocar nada fuera del
    directorio temporal del test."""

    def test_realpath_resolving_outside_working_dir_is_rejected(self):
        self.make_valid_db()
        outside_dir = tempfile.TemporaryDirectory()
        self.addCleanup(outside_dir.cleanup)
        fake_target = os.path.join(outside_dir.name, 'afuera.db')

        real_realpath = os.path.realpath

        def fake_realpath(path, *args, **kwargs):
            if os.path.normcase(os.path.abspath(path)) == os.path.normcase(os.path.abspath(self.db_path)):
                return real_realpath(fake_target)
            return real_realpath(path, *args, **kwargs)

        with mock.patch('os.path.realpath', side_effect=fake_realpath):
            with self.assertRaises(inspector.InspectionAborted) as ctx:
                inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_PATH_ESCAPES_WORKING)


class RegularFileTests(InspectorTestCase):
    def test_nonexistent_file_is_rejected(self):
        missing_path = os.path.join(self.working_dir, 'no-existe.db')
        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(missing_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_NOT_FOUND)

    def test_directory_is_rejected(self):
        subdir = os.path.join(self.working_dir, 'subcarpeta')
        os.makedirs(subdir)
        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(subdir, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_NOT_REGULAR_FILE)


class AuxiliaryFilePreflightTests(InspectorTestCase):
    """WAL, SHM y journal preexistentes abortan antes de abrir SQLite
    -- nunca se intenta reparar ni checkpointear. Cada test confirma,
    via spy sobre open_readonly, que la apertura nunca se intenta."""

    def _assert_aborts_without_opening(self, suffix):
        self.make_valid_db()
        aux_path = self.db_path + suffix
        with open(aux_path, 'wb') as f:
            f.write(b'contenido-sintetico-de-auxiliar')

        with mock.patch.object(inspector, 'open_readonly') as mocked_open:
            with self.assertRaises(inspector.InspectionAborted) as ctx:
                inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_WAL_OR_SHM_PRESENT)
        mocked_open.assert_not_called()
        # No se intento "reparar": el auxiliar sigue exactamente igual.
        with open(aux_path, 'rb') as f:
            self.assertEqual(f.read(), b'contenido-sintetico-de-auxiliar')

    def test_wal_file_present_aborts_without_opening(self):
        self._assert_aborts_without_opening('-wal')

    def test_shm_file_present_aborts_without_opening(self):
        self._assert_aborts_without_opening('-shm')

    def test_journal_file_present_aborts_without_opening(self):
        self._assert_aborts_without_opening('-journal')


class InvalidDatabaseTests(InspectorTestCase):
    def test_invalid_sqlite_file_is_rejected(self):
        with open(self.db_path, 'w', encoding='utf-8') as f:
            f.write('esto no es un sqlite valido' * 50)

        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertIn(
            str(ctx.exception),
            (inspector.CODE_SQLITE_OPEN_FAILED, inspector.CODE_METADATA_QUERY_FAILED),
        )


class MissingColumnTests(InspectorTestCase):
    def test_missing_expected_column_is_reported_as_absent(self):
        """Simula un esquema pre-migracion-16 de Loop (sin la columna
        'type'): el inspector debe reportarlo como ausente, no fallar
        ni inventar su presencia."""
        conn = sqlite3.connect(self.db_path)
        conn.execute(f'''
            CREATE TABLE {schema.TABLE_HABITS} (
                {schema.COL_HABIT_ID} INTEGER PRIMARY KEY,
                {schema.COL_HABIT_NAME} TEXT,
                {schema.COL_HABIT_FREQ_NUM} INTEGER,
                {schema.COL_HABIT_FREQ_DEN} INTEGER,
                {schema.COL_HABIT_ARCHIVED} INTEGER
            )
        ''')
        conn.execute(f'''
            CREATE TABLE {schema.TABLE_REPETITIONS} (
                {schema.COL_REPETITION_ID} INTEGER PRIMARY KEY,
                {schema.COL_REPETITION_HABIT_ID} INTEGER,
                {schema.COL_REPETITION_TIMESTAMP} INTEGER
            )
        ''')
        conn.commit()
        conn.close()

        result = inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertFalse(result['habitsColumnsPresent'][schema.COL_HABIT_TYPE])
        self.assertTrue(result['habitsColumnsPresent'][schema.COL_HABIT_NAME])
        self.assertFalse(result['repetitionsColumnsPresent'][schema.COL_REPETITION_VALUE])
        self.assertTrue(result['repetitionsColumnsPresent'][schema.COL_REPETITION_HABIT_ID])


class IndexAndForeignKeyTests(InspectorTestCase):
    def test_unique_index_and_foreign_key_are_reported_structurally_without_raw_names(self):
        conn = sqlite3.connect(self.db_path)
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
                {schema.COL_REPETITION_HABIT_ID} INTEGER REFERENCES {schema.TABLE_HABITS}({schema.COL_HABIT_ID}),
                {schema.COL_REPETITION_TIMESTAMP} INTEGER,
                {schema.COL_REPETITION_VALUE} INTEGER
            )
        ''')
        conn.execute(
            f'CREATE UNIQUE INDEX idx_rep_habit_ts ON {schema.TABLE_REPETITIONS} '
            f'({schema.COL_REPETITION_HABIT_ID}, {schema.COL_REPETITION_TIMESTAMP})'
        )
        conn.commit()
        conn.close()

        result = inspector.inspect(self.db_path, 'BACKUP_A')

        self.assertEqual(len(result['repetitionsIndices']), 1)
        idx = result['repetitionsIndices'][0]
        self.assertTrue(idx['unique'])
        self.assertEqual(
            idx['columns'],
            [schema.COL_REPETITION_HABIT_ID, schema.COL_REPETITION_TIMESTAMP],
        )
        self.assertNotIn('name', idx)
        # El nombre crudo del indice nunca debe aparecer en el resultado.
        self.assertNotIn('idx_rep_habit_ts', str(result))

        self.assertEqual(len(result['repetitionsForeignKeys']), 1)
        fk = result['repetitionsForeignKeys'][0]
        self.assertEqual(fk['table'], schema.TABLE_HABITS)
        self.assertEqual(fk['from'], schema.COL_REPETITION_HABIT_ID)
        self.assertEqual(fk['to'], schema.COL_HABIT_ID)


class UnexpectedSchemaNameSanitizationTests(InspectorTestCase):
    def test_unexpected_index_column_is_replaced_by_placeholder(self):
        conn = sqlite3.connect(self.db_path)
        conn.execute(f'''
            CREATE TABLE {schema.TABLE_HABITS} (
                {schema.COL_HABIT_ID} INTEGER PRIMARY KEY,
                {schema.COL_HABIT_NAME} TEXT,
                {schema.COL_HABIT_FREQ_NUM} INTEGER,
                {schema.COL_HABIT_FREQ_DEN} INTEGER,
                {schema.COL_HABIT_ARCHIVED} INTEGER,
                {schema.COL_HABIT_TYPE} INTEGER,
                extra_col_sentinel_7f3a TEXT
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
        conn.execute(f'CREATE INDEX idx_extra ON {schema.TABLE_HABITS} (extra_col_sentinel_7f3a)')
        conn.commit()
        conn.close()

        result = inspector.inspect(self.db_path, 'BACKUP_A')

        self.assertEqual(len(result['habitsIndices']), 1)
        self.assertEqual(result['habitsIndices'][0]['columns'], [inspector.UNKNOWN_NAME_PLACEHOLDER])
        self.assertNotIn('extra_col_sentinel_7f3a', str(result))


class NoPrivateDataExposureTests(InspectorTestCase):
    SENTINEL_PATH_FRAGMENT = 'SENTINEL_WORKING_DIR_7f3a'

    def test_successful_result_never_contains_working_dir_path(self):
        sentinel_working = os.path.join(self._tmpdir.name, self.SENTINEL_PATH_FRAGMENT)
        os.makedirs(sentinel_working)
        db_path = os.path.join(sentinel_working, 'copia.db')
        conn = fixtures.create_synthetic_db(db_path)
        conn.close()

        with mock.patch.object(inspector, '_APPROVED_WORKING_DIR', sentinel_working):
            result = inspector.inspect(db_path, 'BACKUP_A')
        self.assertNotIn(self.SENTINEL_PATH_FRAGMENT, str(result))
        self.assertNotIn('copia.db', str(result))

    def test_aborted_result_never_contains_working_dir_path(self):
        missing_path = os.path.join(self.working_dir, 'SENTINEL_MISSING_7f3a.db')
        with self.assertRaises(inspector.InspectionAborted) as ctx:
            inspector.inspect(missing_path, 'BACKUP_A')
        self.assertNotIn('SENTINEL_MISSING_7f3a', str(ctx.exception))
        self.assertNotIn(self.working_dir, str(ctx.exception))


class ConnectionClosedOnErrorTests(InspectorTestCase):
    def test_connection_is_closed_even_when_a_metadata_query_raises(self):
        self.make_valid_db()
        opened_connections = []
        real_open_readonly = inspector.open_readonly

        def spying_open_readonly(path):
            conn = real_open_readonly(path)
            opened_connections.append(conn)
            return conn

        with mock.patch.object(inspector, 'open_readonly', side_effect=spying_open_readonly):
            with mock.patch.object(inspector, '_foreign_key_list', side_effect=RuntimeError('boom')):
                with self.assertRaises(inspector.InspectionAborted) as ctx:
                    inspector.inspect(self.db_path, 'BACKUP_A')

        self.assertEqual(str(ctx.exception), inspector.CODE_METADATA_QUERY_FAILED)
        self.assertEqual(len(opened_connections), 1)
        with self.assertRaises(sqlite3.ProgrammingError):
            opened_connections[0].execute('SELECT 1')


class NoNewAuxiliaryFilesTests(InspectorTestCase):
    def test_no_wal_shm_journal_appear_after_a_successful_inspection(self):
        self.make_valid_db()
        inspector.inspect(self.db_path, 'BACKUP_A')
        for suffix in ('-wal', '-shm', '-journal'):
            self.assertFalse(os.path.exists(self.db_path + suffix))


class AuxiliaryFileDetectionTests(InspectorTestCase):
    """Pruebas discriminantes: a diferencia de NoNewAuxiliaryFilesTests
    (que solo confirma que el caso feliz no genera auxiliares), estas
    fuerzan la aparicion de un auxiliar como efecto secundario de una
    consulta y confirman que el chequeo posterior lo detecta -- tanto
    si el resto de la inspeccion tuvo exito como si fallo."""

    def test_auxiliary_file_appearing_during_a_successful_query_is_detected(self):
        self.make_valid_db()
        shm_path = self.db_path + '-shm'
        real_foreign_key_list = inspector._foreign_key_list

        def side_effect_creates_shm(conn, table_name):
            with open(shm_path, 'wb') as f:
                f.write(b'aparecido-durante-inspeccion')
            return real_foreign_key_list(conn, table_name)

        with mock.patch.object(inspector, '_foreign_key_list', side_effect=side_effect_creates_shm):
            with self.assertRaises(inspector.InspectionAborted) as ctx:
                inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_UNEXPECTED_AUXILIARY_FILE)

    def test_auxiliary_file_appearing_during_a_failed_query_is_still_detected(self):
        self.make_valid_db()
        journal_path = self.db_path + '-journal'

        def side_effect_creates_journal_then_fails(conn, table_name):
            with open(journal_path, 'wb') as f:
                f.write(b'aparecido-durante-fallo')
            raise RuntimeError('boom')

        with mock.patch.object(inspector, '_foreign_key_list', side_effect=side_effect_creates_journal_then_fails):
            with self.assertRaises(inspector.InspectionAborted) as ctx:
                inspector.inspect(self.db_path, 'BACKUP_A')
        # El chequeo posterior corrio igual y su codigo reemplazo al
        # de la falla original -- ambos son codigos tecnicos estables,
        # ninguno filtra informacion adicional.
        self.assertEqual(str(ctx.exception), inspector.CODE_UNEXPECTED_AUXILIARY_FILE)


class ExceptionChainingSuppressedTests(InspectorTestCase):
    def test_sqlite_open_failure_does_not_chain_the_original_exception(self):
        self.make_valid_db()
        with mock.patch.object(inspector, 'open_readonly', side_effect=RuntimeError('mensaje-original-no-sanitizado')):
            with self.assertRaises(inspector.InspectionAborted) as ctx:
                inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_SQLITE_OPEN_FAILED)
        self.assertIsNone(ctx.exception.__cause__)

    def test_metadata_query_failure_does_not_chain_the_original_exception(self):
        self.make_valid_db()
        with mock.patch.object(inspector, '_foreign_key_list', side_effect=RuntimeError('otro-mensaje-no-sanitizado')):
            with self.assertRaises(inspector.InspectionAborted) as ctx:
                inspector.inspect(self.db_path, 'BACKUP_A')
        self.assertEqual(str(ctx.exception), inspector.CODE_METADATA_QUERY_FAILED)
        self.assertIsNone(ctx.exception.__cause__)


if __name__ == '__main__':
    unittest.main()
