import ast
from pathlib import Path
import runpy
import unittest

PATH = Path(__file__).with_name('test_structure.py')


class StructureCompatibility(unittest.TestCase):
    def test_structure_checker_supports_python_without_try_star(self):
        original = getattr(ast, 'TryStar', None)
        try:
            if original is not None:
                delattr(ast, 'TryStar')
            namespace = runpy.run_path(str(PATH), run_name='structure_compatibility')
            self.assertIn(ast.Try, namespace['CONTROL'])
        finally:
            if original is not None:
                ast.TryStar = original

    def test_depth_calculator_distinguishes_four_and_five_control_levels(self):
        four = ('def four():\n'
                '    if ready:\n'
                '        for item in items:\n'
                '            while pending:\n'
                '                with resource:\n'
                '                    pass\n')
        five = ('def five():\n'
                '    if ready:\n'
                '        for item in items:\n'
                '            while pending:\n'
                '                with resource:\n'
                '                    if active:\n'
                '                        pass\n')
        namespace = runpy.run_path(str(PATH), run_name='structure_depth_fixtures')
        depth = namespace['nesting_depth']
        for source, expected in ((four, 4), (five, 5)):
            with self.subTest(expected=expected):
                function = ast.parse(source).body[0]
                self.assertEqual(max(depth(statement) for statement in function.body), expected)

    def test_structure_checker_checks_its_own_nesting(self):
        namespace = runpy.run_path(str(PATH), run_name='structure_self_check')
        depth = namespace['nesting_depth']
        functions = [node for node in ast.walk(ast.parse(PATH.read_text())) if isinstance(node, ast.FunctionDef)]
        for function in functions:
            with self.subTest(function=function.name):
                self.assertLessEqual(max((depth(statement) for statement in function.body), default=0), 4)


if __name__ == '__main__':
    unittest.main()
