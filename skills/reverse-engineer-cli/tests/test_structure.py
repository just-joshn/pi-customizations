import ast
from pathlib import Path
import unittest

SKILLS = Path(__file__).resolve().parents[2]
TOOL_SKILLS = ('doctor', 'implement-cli-from-contract', 'reverse-engineer-cli')
CONTROL = (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith)
CONTROL += (ast.TryStar,) if hasattr(ast, 'TryStar') else ()


def nesting_depth(node: ast.AST, depth: int = 0) -> int:
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        return 0
    current = depth + int(isinstance(node, CONTROL))
    return max([current, *(nesting_depth(child, current) for child in ast.iter_child_nodes(node))])


def maintained_sources():
    return ((path, path.read_text()) for name in TOOL_SKILLS for path in (SKILLS / name).rglob('*.py'))


def functions(source: str):
    return (node for node in ast.walk(ast.parse(source)) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)))


class PythonStructure(unittest.TestCase):
    def test_maintained_scripts_and_tests_obey_nesting_limit(self):
        for path, source in maintained_sources():
            for node in functions(source):
                with self.subTest(file=str(path.relative_to(SKILLS)), function=node.name):
                    self.assertLessEqual(max((nesting_depth(statement) for statement in node.body), default=0),
                                         4, f'{path}:{node.lineno} {node.name}')

    def test_maintained_scripts_and_tests_obey_file_and_function_limits(self):
        for path, source in maintained_sources():
            relative = path.relative_to(SKILLS)
            with self.subTest(file=str(relative)):
                self.assertLess(len(source.splitlines()), 800, str(relative))
            for node in functions(source):
                with self.subTest(file=str(relative), function=node.name):
                    self.assertLess(node.end_lineno - node.lineno + 1, 50,
                                    f'{relative}:{node.lineno} {node.name}')


if __name__ == '__main__':
    unittest.main()
