#!/usr/bin/env python3
"""Tạo src/lib/prompt-lib.js từ public/prompt/data.js (Thư viện prompt) để trợ lý AI đọc mẫu prompt phía máy chủ.
Chạy lại sau mỗi lần cập nhật Thư viện prompt:  python3 tools/prompt-index.py"""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
src = (root / 'public/prompt/data.js').read_text(encoding='utf-8')
a = src.index('[')
data, _ = json.JSONDecoder().raw_decode(src[a:])
lib = {x['id']: {'n': x['name'], 'k': x['kind'], 't': x['text'][:1500]} for x in data}
out = ('// Tự sinh bởi tools/prompt-index.py từ public/prompt/data.js, không sửa tay.\n'
       '// Mẫu prompt (tên, loại ảnh/video/doc, nội dung) để trợ lý AI viết prompt hoàn chỉnh cho từng bài.\n'
       'export const PROMPT_LIB = ' + json.dumps(lib, ensure_ascii=False, separators=(',', ':')) + ';\n')
(root / 'src/lib/prompt-lib.js').write_text(out, encoding='utf-8')
print(f'{len(lib)} mẫu prompt -> src/lib/prompt-lib.js ({len(out.encode())//1024} KB)')
