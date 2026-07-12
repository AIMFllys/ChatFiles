# SQLCipher snapshot helper

This Windows helper creates a plaintext snapshot from a live SQLCipher WAL database without opening the source in a mode that may initialize or rewrite its shared-memory file.

## Safety contract

- The source is opened with SQLite URI `readonly_shm=1` and a read transaction.
- The 32-byte raw key is accepted only on stdin and is zeroed after setup.
- The destination must not exist. The helper reserves it with `CREATE_NEW`.
- The backup is decrypted only in the destination.
- Validation requires `PRAGMA integrity_check` and equal logical schema tuples `(type, name, tbl_name, sql)`.
- `rootpage` is intentionally excluded because SQLCipher decryption changes reserved page bytes and SQLite3 Multiple Ciphers performs a legitimate `VACUUM`, which may reassign physical B-tree pages.
- Stdout is a fixed binary success frame. Stderr contains only whitelisted error codes.

## Build

Install dependencies first, then run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File tools/sqlcipher-snapshot/build.ps1
```

The versioned executable and compiler intermediates are written under ignored `work/tools/` paths. The script requires Visual Studio C++ Build Tools and uses the SQLite3 Multiple Ciphers amalgamation shipped with the installed development dependency.

## Native fixture

```powershell
$env:CHATFILES_SQLCIPHER_HELPER = 'D:\path\to\sqlcipher-snapshot-helper.exe'
npx tsx --test scripts/wechat/sqlcipherSnapshotHelper.integration.test.ts
```
