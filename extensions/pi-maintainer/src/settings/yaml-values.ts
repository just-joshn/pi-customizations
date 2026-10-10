/**
 * PyYAML's implicit scalar resolution followed by Python's `str()`, which is how
 * configargparse turns a `.aider.conf.yml` value into command-line text.
 */

const BOOL = /^(?:yes|Yes|YES|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF)$/;
const TRUE_WORDS = new Set(['yes', 'Yes', 'YES', 'true', 'True', 'TRUE', 'on', 'On', 'ON']);
const NULL = /^(?:~|null|Null|NULL|)$/;
const INT = /^(?:[-+]?0b[0-1_]+|[-+]?0[0-7_]+|[-+]?(?:0|[1-9][0-9_]*)|[-+]?0x[0-9a-fA-F_]+|[-+]?[1-9][0-9_]*(?::[0-5]?[0-9])+)$/;
const FLOAT = /^(?:[-+]?(?:[0-9][0-9_]*)\.[0-9_]*(?:[eE][-+][0-9]+)?|\.[0-9][0-9_]*(?:[eE][-+][0-9]+)?|[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*|[-+]?\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/;

function splitSign(text: string): { sign: bigint; digits: string } {
  if (text.startsWith('-')) return { sign: -1n, digits: text.slice(1) };
  return { sign: 1n, digits: text.startsWith('+') ? text.slice(1) : text };
}

/** PyYAML's `construct_yaml_int`, rendered by Python's `str()`. */
function intText(source: string): string {
  const { sign, digits } = splitSign(source.replace(/_/g, ''));
  if (digits === '0') return '0';
  if (digits.startsWith('0b')) return (sign * BigInt(`0b${digits.slice(2)}`)).toString();
  if (digits.startsWith('0x')) return (sign * BigInt(`0x${digits.slice(2)}`)).toString();
  if (digits.startsWith('0')) return (sign * BigInt(`0o${digits.slice(1)}`)).toString();
  if (digits.includes(':')) return (sign * digits.split(':').reduce((value, part) => value * 60n + BigInt(part), 0n)).toString();
  return (sign * BigInt(digits)).toString();
}

/** Python's `repr(float)`: shortest round-trip digits, scientific below 1e-4 and from 1e16. */
export function pyFloatText(value: number): string {
  if (Number.isNaN(value)) return 'nan';
  if (!Number.isFinite(value)) return value > 0 ? 'inf' : '-inf';
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-4 || magnitude >= 1e16)) {
    const [mantissa = '', exponent = ''] = value.toExponential().split('e');
    const sign = exponent.startsWith('-') ? '-' : '+';
    return `${mantissa}e${sign}${exponent.replace(/^[-+]/, '').padStart(2, '0')}`;
  }
  const text = Object.is(value, -0) ? '-0' : value.toString();
  return text.includes('.') ? text : `${text}.0`;
}

/** PyYAML's `construct_yaml_float`, rendered by Python's `str()`. */
function floatText(source: string): string {
  const lowered = source.replace(/_/g, '').toLowerCase();
  const negative = lowered.startsWith('-');
  const unsigned = lowered.replace(/^[-+]/, '');
  if (unsigned === '.inf') return negative ? '-inf' : 'inf';
  if (unsigned === '.nan') return 'nan';
  const magnitude = unsigned.includes(':') ? unsigned.split(':').reduce((value, part) => value * 60 + Number(part), 0) : Number(unsigned);
  return pyFloatText(negative ? -magnitude : magnitude);
}

/** The `str()` of a plain YAML scalar after PyYAML resolves it, or null for YAML null. */
export function plainScalarText(source: string): string | null {
  if (BOOL.test(source)) return TRUE_WORDS.has(source) ? 'True' : 'False';
  if (NULL.test(source)) return null;
  if (INT.test(source)) return intText(source);
  if (FLOAT.test(source)) return floatText(source);
  return source;
}
