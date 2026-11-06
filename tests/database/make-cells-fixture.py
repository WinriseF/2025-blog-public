import pathlib, sqlite3
path = pathlib.Path('.tmp/database/cells.sqlite')
path.parent.mkdir(parents=True, exist_ok=True)
if path.exists(): path.unlink()
c = sqlite3.connect(path)
c.execute('CREATE TABLE cells(id INTEGER PRIMARY KEY, name TEXT, note TEXT, json_text TEXT, empty TEXT, missing TEXT, large INTEGER, binary BLOB)')
raw = '{"large":9223372036854775807,"decimal":1.0000,"word":"\\u4e2d","nested":{"ok":true},"dup":1,"dup":2}'
note = 'BEGIN\t"quoted"\n' + '这是一段需要完整查看和复制的长文本。' * 120 + '\nFIND-ME-END'
c.executemany('INSERT INTO cells VALUES(?,?,?,?,?,?,?,?)', [(i, f'row-{i}', note, raw, '', None, 9223372036854775807, bytes(range(64))) for i in range(1, 241)])
c.commit()
c.close()
