"""Check committed product files, outgoing history and the actual npm archive."""
import argparse
import functools
import json
from pathlib import PurePosixPath
import re
import subprocess
import sys
import tarfile

ROOT_FILES = {'.gitignore', 'LICENSE', 'README.md', 'package.json', 'package-lock.json',
              'cordis.patch.yml', 'index.js', 'client.js', 'cli.js',
              '.githooks/pre-push', '.github/workflows/check.yml', 'scripts/check-repository.py'}
TREES = {'src': '.js', 'test': '.js', 'locale': '.json', 'sources': '.json',
         'schemas': '.json', 'doc': '.md'}
PRIVATE = re.compile(rb'-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|sk-(?:proj-)?[A-Za-z0-9_-]{32,}|(?:npm_|AKIA)[A-Za-z0-9]{16,}|https?://[^/\s:@]+:[^/\s@]+@|/(?:[U]sers|[h]ome)/[\w.-]+/|[?&]token=[A-Za-z0-9_-]{20,}')
LOCAL_PARTS = {'.git', '.dsh', '.codex', '.agents', 'node_modules', 'artifacts', 'runtime', 'backups', '__pycache__'}


def git(*args):
    return subprocess.check_output(['git', *args])


@functools.lru_cache(maxsize=None)
def check_blob(name, mode, oid):
    p = PurePosixPath(name)
    allowed = name in ROOT_FILES or (TREES.get(p.parts[0]) == p.suffix and len(p.parts) > 1)
    if not allowed or LOCAL_PARTS.intersection(p.parts) or any(
            s.startswith(('.env', '.npmrc')) for s in p.parts):
        raise ValueError(f'file outside the product inventory: {name}')
    if mode not in ('100644', '100755'):
        raise ValueError(f'unsupported file type: {name}')
    data = git('cat-file', 'blob', oid)
    if b'\0' in data or PRIVATE.search(data):
        raise ValueError(f'binary data, local path or credential-like content: {name}')
    data.decode('utf-8')


def check_tree(rev):
    objects = {}
    for entry in git('ls-tree', '-rz', rev).split(b'\0'):
        if not entry:
            continue
        meta, rawname = entry.split(b'\t', 1)
        mode, _, oid = meta.decode().split()
        name = rawname.decode()
        check_blob(name, mode, oid)
        objects[name] = oid
    return objects


def check_package(objects, archive):
    manifest = json.loads(git('cat-file', 'blob', objects['package.json']))
    lock = json.loads(git('cat-file', 'blob', objects['package-lock.json']))
    for record in (lock, lock['packages']['']):
        if (record['name'], record['version']) != (manifest['name'], manifest['version']):
            raise ValueError('manifest and lockfile versions differ')
    roots = set(manifest['files']) | {'package.json', 'LICENSE', 'README.md'}
    expected = {n for n in objects if any(n == r or n.startswith(r + '/') for r in roots)}
    for n in expected:
        if n.startswith(('test/', 'scripts/', '.github/', '.githooks/')) or n == 'package-lock.json':
            raise ValueError(f'development file selected for npm: {n}')
    seen = set()
    with tarfile.open(archive, 'r:gz') as tgz:
        for item in tgz:
            if item.isdir():
                continue
            name = item.name.removeprefix('package/')
            if not item.name.startswith('package/') or not item.isfile() or name in seen or name not in expected:
                raise ValueError(f'unexpected archive entry: {item.name}')
            if tgz.extractfile(item).read() != git('cat-file', 'blob', objects[name]):
                raise ValueError(f'archive differs from Git: {name}')
            seen.add(name)
    if expected != seen:
        raise ValueError(f'missing archive files: {sorted(expected - seen)}')
    for path in [manifest['dsh']['bundle']['patch'], *manifest['bin'].values(),
                 *manifest['exports'].values()]:
        pattern = path.removeprefix('./')
        if not any(PurePosixPath(n).match(pattern) for n in seen):
            raise ValueError(f'package entry missing: {path}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('ref', nargs='?', default='HEAD')
    parser.add_argument('--history', action='store_true', help='check every reachable commit')
    parser.add_argument('--archive', help='compare an npm tarball with the selected commit')
    args = parser.parse_args()
    try:
        commits = git('rev-list', args.ref).decode().split() if args.history else [args.ref]
        for commit in commits:
            check_tree(commit)
        if args.archive:
            check_package(check_tree(args.ref), args.archive)
        print(f'Checked {len(commits)} Git tree(s)' + (' and npm tarball' if args.archive else ''))
    except (ValueError, KeyError, OSError, tarfile.TarError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
