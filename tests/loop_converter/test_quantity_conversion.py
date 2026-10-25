"""Tests sinteticos de tools/loop_quantity.stored_value_to_minutes.

La escala real de Repetitions.value de Loop NO esta confirmada: las
escalas 1 y 1000 se prueban como parametros explicitos, no como
suposicion. Los valores son aritmetica pura, sin relacion con datos reales.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'tools'))
import loop_quantity as q  # noqa: E402

TOOLS_DIR = os.path.join(os.path.dirname(__file__), '..', '..', 'tools')


def conv(stored, scale, unit='hs'):
    return q.stored_value_to_minutes(stored, scale, unit)


class ScaleOneTests(unittest.TestCase):
    def test_hours_to_minutes(self):
        self.assertEqual(conv(2, 1), 120)
        self.assertEqual(conv(1, 1), 60)
        self.assertEqual(conv(25, 1), 1500)

    def test_zero_is_plain_arithmetic_not_interpreted(self):
        self.assertEqual(conv(0, 1), 0)


class ScaleThousandTests(unittest.TestCase):
    def test_exact_conversions(self):
        self.assertEqual(conv(2000, 1000), 120)
        self.assertEqual(conv(500, 1000), 30)      # 0.5 h
        self.assertEqual(conv(25000, 1000), 1500)
        self.assertEqual(conv(250, 1000), 15)      # 0.25 h
        self.assertEqual(conv(0, 1000), 0)

    def test_precision_loss_is_rejected_not_rounded(self):
        for stored in (1, 7, 16, 999, 2001):  # 60*stored no divisible por 1000
            with self.subTest(stored=stored):
                with self.assertRaises(q.QuantityConversionError) as ctx:
                    conv(stored, 1000)
                self.assertEqual(str(ctx.exception), q.CODE_PRECISION_LOSS)

    def test_boundary_divisible_values(self):
        self.assertEqual(conv(50, 1000), 3)        # 0.05 h = 3 min
        with self.assertRaises(q.QuantityConversionError):
            conv(49, 1000)


class InvalidInputTests(unittest.TestCase):
    def assertCode(self, code, *args):
        with self.assertRaises(q.QuantityConversionError) as ctx:
            q.stored_value_to_minutes(*args)
        self.assertEqual(str(ctx.exception), code)

    def test_invalid_stored_values(self):
        for bad in (-1, True, False, 1.0, 2.5, '120', None, [1], float('nan')):
            with self.subTest(bad=bad):
                self.assertCode(q.CODE_INVALID_STORED_VALUE, bad, 1, 'hs')

    def test_invalid_scale_factors(self):
        for bad in (0, -1, -1000, True, 1.0, 1000.0, '1000', None):
            with self.subTest(bad=bad):
                self.assertCode(q.CODE_INVALID_SCALE_FACTOR, 5, bad, 'hs')

    def test_unsupported_units(self):
        for bad in ('minutes', 'min', 'HS', 'h', 'hs ', '', None, 60):
            with self.subTest(bad=bad):
                self.assertCode(q.CODE_UNSUPPORTED_UNIT, 5, 1, bad)

    def test_no_default_scale_factor(self):
        with self.assertRaises(TypeError):
            q.stored_value_to_minutes(2, unit='hs')
        with self.assertRaises(TypeError):
            q.stored_value_to_minutes(2, 1)

    def test_result_beyond_js_safe_integer_is_rejected(self):
        self.assertCode(q.CODE_RESULT_OUT_OF_RANGE, 2**53, 1, 'hs')
        self.assertEqual(conv((2**53 - 1) // 60, 1), ((2**53 - 1) // 60) * 60)

    def test_error_messages_never_reflect_inputs(self):
        for args in ((123456789, 1000, 'hs'), (-987654, 1, 'hs'), (5, 777, 'SECRETUNIT')):
            try:
                q.stored_value_to_minutes(*args)
            except q.QuantityConversionError as e:
                for token in ('123456789', '987654', '777', 'SECRETUNIT'):
                    self.assertNotIn(token, str(e))


class NotIntegratedTests(unittest.TestCase):
    def test_converter_does_not_import_quantity_module_yet(self):
        with open(os.path.join(TOOLS_DIR, 'loop_habits_to_json.py'), encoding='utf-8') as f:
            self.assertNotIn('loop_quantity', f.read())


if __name__ == '__main__':
    unittest.main()
