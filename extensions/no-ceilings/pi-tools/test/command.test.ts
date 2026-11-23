import { describe, expect, it } from 'vitest';
import { analyzeCommand, analyzeShellCommand, directoryChanges, normalizeCommand, splitCommand } from '../src/core/command.ts';

/** Unit coverage for the shell analyzer: decoding, wrappers, directory targets, and refusals. */

const segments = (command: string): string[] => [...analyzeShellCommand(command, '/home/user').segments];
const untrusted = (command: string): string | undefined => analyzeShellCommand(command, '/home/user').untrusted;

describe('shell analysis: quoting and escapes', () => {
  it('decodes ANSI-C escapes the way bash does', () => {
    expect(analyzeCommand("printf '%s' $'\\x41'")).toEqual(['printf %s A']);
    expect(analyzeCommand("printf '%s' $'\\101'")).toEqual(['printf %s A']);
    expect(analyzeCommand("printf '%s' $'\\u0041'")).toEqual(['printf %s A']);
    expect(analyzeCommand("printf '%s' $'tab\\there'")).toEqual(['printf %s tab\there']);
    expect(analyzeCommand("printf '%s' $'it\\'s'")).toEqual(["printf %s it's"]);
    expect(analyzeCommand("printf '%s' $'\\e'")).toEqual(['printf %s \u001b']);
    expect(analyzeCommand("printf '%s' $'\\cA'")).toEqual(['printf %s \u0001']);
    expect(analyzeCommand("printf '%s' $'\\q'")).toEqual(['printf %s q']);
  });

  it('removes quotes and backslash escapes before matching', () => {
    expect(analyzeCommand(`echo 'a b'`)).toEqual(['echo a b']);
    expect(analyzeCommand('echo "a b"')).toEqual(['echo a b']);
    expect(analyzeCommand('echo a\\ b')).toEqual(['echo a b']);
    expect(analyzeCommand("echo $'a b'")).toEqual(['echo a b']);
    expect(analyzeCommand('echo sec"ret"-value')).toEqual(['echo secret-value']);
    expect(normalizeCommand('  echo   x  ')).toBe('echo x');
  });

  it('refuses an unterminated quote', () => {
    expect(untrusted("echo 'a")).toBe('the command has an unterminated quote');
    expect(untrusted('echo "a')).toBe('the command has an unterminated quote');
  });

  it('keeps separators inside quotes', () => {
    expect(splitCommand(`echo 'a; b'; echo c`)).toEqual([`echo 'a; b'`, 'echo c']);
    expect(splitCommand("echo $'a; b'; echo c")).toEqual(["echo $'a; b'", 'echo c']);
    expect(analyzeCommand("echo $'a; b'")).toEqual(['echo a; b']);
  });
});

describe('shell analysis: assignments and wrappers', () => {
  it('strips assignments before the executable', () => {
    expect(segments('FOO=1 echo x')).toEqual(['echo x']);
    expect(segments('FOO=/usr/bin:/bin echo x')).toEqual(['echo x']);
    expect(segments('FOO+=x echo x')).toEqual(['echo x']);
    expect(segments('FOO=1')).toEqual([]);
  });

  it('refuses assignments that change command resolution or startup', () => {
    for (const command of ['BASH_ENV=x sh -c true', 'ENV=x sh -c true', 'CDPATH=/tmp cd .', 'IFS=: true']) {
      expect(untrusted(command), command).toContain('changes how the shell finds commands');
    }
    expect(untrusted('PATH=/tmp/bin true')).toBeUndefined();
  });

  it('looks through known wrappers and their flags', () => {
    const cases: [string, string][] = [
      ['env FOO=1 echo x', 'echo x'],
      ['env -i echo x', 'echo x'],
      ['env -u FOO echo x', 'echo x'],
      ['env --unset=FOO echo x', 'echo x'],
      ['env -C /tmp echo x', 'echo x'],
      ['command -p echo x', 'echo x'],
      ['nohup echo x', 'echo x'],
      ['time -p echo x', 'echo x'],
      ['exec -a name echo x', 'echo x'],
      ['builtin echo x', 'echo x'],
      ['timeout 5 echo x', 'echo x'],
      ['timeout -s KILL 5 echo x', 'echo x'],
      ['timeout --signal=KILL 5 echo x', 'echo x'],
      ['nice -n 5 echo x', 'echo x'],
      ['nice --adjustment=5 echo x', 'echo x'],
      ['stdbuf -o0 echo x', 'echo x'],
      ['stdbuf --output=0 echo x', 'echo x'],
      ['setsid -f echo x', 'echo x'],
      ['/usr/bin/env echo x', 'echo x'],
    ];
    for (const [command, expected] of cases) {
      expect(segments(command), command).toEqual([expected]);
    }
  });

  it('leaves a query alone instead of unwrapping it', () => {
    expect(segments('command -v echo')).toEqual(['command -v echo']);
    expect(segments('command -V echo')).toEqual(['command -V echo']);
  });

  it('refuses wrappers that run another command', () => {
    for (const command of ['sudo echo x', 'doas echo x', 'su root', 'chroot / echo x', 'xargs echo', 'parallel echo', 'watch echo', 'script out.txt']) {
      expect(untrusted(command), command).toContain('does not follow');
    }
    expect(untrusted('find . -name x -exec echo {} ;')).toContain('find -exec');
    expect(untrusted('find . -name x -ok echo {} ;')).toContain('find -exec');
    expect(untrusted('env -S "echo x"')).toContain('env -S');
  });

  it('refuses a command word built by an expansion', () => {
    expect(untrusted('$EDITOR file')).toBe('the command word comes from an expansion');
    expect(untrusted('${EDITOR} file')).toBe('the command word comes from an expansion');
    expect(untrusted('$(echo echo) file')).toBe('the command word comes from an expansion');
    expect(untrusted('`echo echo` file')).toBe('the command word comes from an expansion');
  });

  it('refuses a function definition', () => {
    expect(untrusted('touch() { echo hi; }; touch x')).toContain('defines a shell function');
    expect(untrusted('function touch { echo hi; }; touch x')).toContain('defines a shell function');
  });
});

describe('shell analysis: nested shells and substitutions', () => {
  it('follows inline shells', () => {
    expect(segments(`sh -c 'echo x'`)).toEqual(['sh -c echo x', 'echo x']);
    expect(segments(`bash -lc 'echo x'`)).toEqual(['bash -lc echo x', 'echo x']);
    expect(segments(`bash -ec 'echo x'`)).toEqual(['bash -ec echo x', 'echo x']);
    expect(segments(`/bin/sh -c 'echo x'`)).toEqual(['sh -c echo x', 'echo x']);
  });

  it('refuses a shell that reads its script from a pipe or a redirect', () => {
    expect(untrusted(`echo 'echo x' | bash`)).toContain('standard input');
    expect(untrusted('bash < script.sh')).toContain('standard input');
    expect(untrusted('bash <<EOF\ntrue\nEOF')).toContain('standard input');
  });

  it('follows eval and substitutions', () => {
    expect(segments(`eval 'echo x'`)).toEqual(['eval echo x', 'echo x']);
    expect(segments('echo $(echo x)')).toEqual(['echo $(echo x)', 'echo x']);
    expect(segments('echo `echo x`')).toEqual(['echo `echo x`', 'echo x']);
    expect(directoryChanges('echo $(cd /tmp && pwd)')).toEqual(['/tmp']);
  });

  it('keeps segments in order and deduplicated', () => {
    expect(segments('echo a; echo a')).toEqual(['echo a']);
    expect(segments('echo a && echo b')).toEqual(['echo a', 'echo b']);
  });

  it('drops redirections without touching quoted text', () => {
    expect(segments('echo x > out.txt')).toEqual(['echo x']);
    expect(segments('echo x 2>&1')).toEqual(['echo x']);
    expect(segments('echo x >> "a b.txt"')).toEqual(['echo x']);
    expect(segments("echo 'a > b'")).toEqual(['echo a > b']);
    expect(segments('cat < in.txt')).toEqual(['cat']);
  });
});

describe('shell analysis: directory targets', () => {
  it('expands home and the known variables', () => {
    expect(directoryChanges('cd', '/home/user')).toEqual(['/home/user']);
    expect(directoryChanges('cd ~', '/home/user')).toEqual(['/home/user']);
    expect(directoryChanges('cd ~/sub', '/home/user')).toEqual(['/home/user/sub']);
    expect(directoryChanges('cd $HOME/sub', '/home/user')).toEqual(['/home/user/sub']);
    expect(directoryChanges('cd ${HOME}/sub', '/home/user')).toEqual(['/home/user/sub']);
    expect(directoryChanges('cd $PWD/sub', '/home/user')).toEqual(['sub']);
    // The spawn pins OLDPWD to the working directory, so this is a change to itself.
    expect(directoryChanges('cd $OLDPWD', '/home/user')).toEqual(['.']);
    expect(directoryChanges('cd -', '/home/user')).toEqual(['.']);
    expect(directoryChanges('cd -- /tmp', '/home/user')).toEqual(['/tmp']);
    expect(directoryChanges('pushd /tmp', '/home/user')).toEqual(['/tmp']);
  });

  it('refuses a target it cannot resolve', () => {
    expect(untrusted('cd "$DIR"')).toContain('$DIR');
    expect(untrusted('cd ${DIR}/sub')).toContain('$DIR');
    expect(untrusted('cd foo/$BAR')).toContain('expansion');
    expect(untrusted('cd `pwd`')).toContain('expansion');
  });

  it('follows env -C as a directory change', () => {
    expect(directoryChanges('env -C /tmp echo x', '/home/user')).toEqual(['/tmp']);
    expect(directoryChanges('env --chdir=/tmp echo x', '/home/user')).toEqual(['/tmp']);
    expect(directoryChanges('env -C/tmp echo x', '/home/user')).toEqual(['/tmp']);
    expect(untrusted('env -C "$DIR" echo x')).toContain('$DIR');
  });

  it('resolves later targets against earlier ones', () => {
    expect(directoryChanges('cd /tmp && cd sub', '/home/user')).toEqual(['/tmp', 'sub']);
    expect(directoryChanges(`cd /tmp && sh -c 'cd sub && pwd'`, '/home/user')).toEqual(['/tmp', 'sub']);
  });
});
