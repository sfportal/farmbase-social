/* Dựng file JSON cho AI đọc: chọn prompt phù hợp để làm video, ảnh, proposal.
   Dùng chung cho trang (nút "Xuất JSON cho AI") và tools/xuat-ai.js (tạo thu-vien-prompt-ai.json). */
(function (root) {
  const KIND = { video: 'Video', image: 'Hình ảnh', doc: 'Tài liệu' };
  const strip = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd');
  function parsePh(x) {
    let label = x, options = [], example = '';
    const exm = x.match(/(?:,\s*|\s)(?:ví dụ|e\.g\.)\s*(.+)$/i);
    if (exm) { example = exm[1]; label = x.slice(0, exm.index); }
    const ci = x.indexOf(':');
    if (ci > 0 && (!exm || ci < exm.index)) {
      label = x.slice(0, ci);
      const rest = x.slice(ci + 1, exm ? exm.index : undefined).trim();
      if (/\s\/\s/.test(rest)) options = rest.split(/\s\/\s/).map(o => o.trim()).filter(Boolean); else if (!example) example = rest;
    } else if (/\//.test(x) && x.split('/').length <= 6 && x.length < 80 && !/^\d+:\d+$/.test(x)) {
      options = x.split('/').map(o => o.trim()).filter(Boolean); label = 'Chọn một';
    }
    return { token: '[' + x + ']', label: label.trim(), options, example };
  }
  function placeholders(t) {
    const seen = new Set(), out = [];
    (String(t || '').match(/\[([^\[\]\n]{2,90})\]/g) || []).forEach(m => {
      const x = m.slice(1, -1);
      if (/^[\d.,\s]+$/.test(x) || /^\{/.test(x) || seen.has(x)) return;
      seen.add(x); out.push(parsePh(x));
    });
    return out;
  }
  function keywords(p) {
    const w = new Set([p.groupName, p.sub, ...(p.duan || []), ...(p.kho || []), KIND[p.kind]].filter(Boolean).map(s => s.toLowerCase()));
    String(p.name).toLowerCase().split(/[,:;()"“”]+|\s[–-]\s/).map(x => x.trim()).filter(x => x.length > 2).forEach(x => w.add(x));
    return [...w];
  }
  // Hiệu ứng chuyển động: id, tên Việt, tên Anh, mô tả, cách dựng bằng HTML/CSS/canvas, regex nhận diện trong prompt
  const FX = [
    ['spring', 'Lò xo', 'Spring easing', 'Phần tử vào hơi vượt rồi bật về vị trí, cảm giác nhanh và sống.', 'Hàm spring tự viết (độ cứng 170–220, giảm chấn 18–26); vượt tối đa 6–10%.', /lò xo|spring|overshoot|bật nhẹ/i],
    ['stagger', 'Lệch nhịp', 'Stagger', 'Nhiều phần tử hiện nối nhau cách vài khung.', 'Mỗi phần tử trễ 60–120 ms; thứ tự theo hướng đọc.', /lệch nhịp|stagger|lần lượt|nối nhau|từng thẻ|từng dòng/i],
    ['kinetic_type', 'Chữ chuyển động', 'Kinetic typography', 'Chữ dập, hiện từng từ, phóng to theo nhịp.', 'Tách chữ thành span; scale 1.3→1 trong 180 ms, giữ ít nhất 1.2 s.', /chữ dập|kinetic|hiện từng từ|từng chữ|typewriter|đánh máy|phụ đề nhấn/i],
    ['draw_line', 'Vẽ nét', 'Line draw', 'Đường viền, bản đồ, biểu đồ tự vẽ ra.', 'SVG stroke-dasharray/stroke-dashoffset chạy từ độ dài đầy đủ về 0.', /vẽ nét|tự vẽ|dashoffset|stroke|đường kẻ|vẽ tay|nét vẽ|line draw/i],
    ['counter', 'Đếm số', 'Number counter / odometer', 'Con số chạy lên tới giá trị đích.', 'Nội suy theo t với ease-out; định dạng dấu chấm nghìn kiểu Việt.', /đếm|odometer|count.?up|chạy số|số chạy|counter/i],
    ['ken_burns', 'Ken Burns', 'Ken Burns', 'Ảnh tĩnh phóng chậm và trôi nhẹ.', 'transform scale 1→1.08 kèm translate 2–3% trong suốt cảnh.', /ken burns|phóng chậm|zoom chậm|slow zoom/i],
    ['parallax', 'Thị sai nhiều lớp', 'Parallax', 'Các lớp trước sau trôi khác tốc độ, tạo chiều sâu.', '3–4 lớp, tốc độ 0.3/0.6/1.0; cảnh nền trôi chậm nhất.', /parallax|thị sai|nhiều lớp/i],
    ['mask_reveal', 'Hé lộ bằng mặt nạ', 'Mask reveal', 'Hình hoặc chữ hiện qua một hình cắt đang mở rộng.', 'clip-path circle()/inset() animate; hoặc mask SVG.', /mask|mặt nạ|clip-path|hé lộ|reveal/i],
    ['match_cut', 'Biến hình vật thể', 'Match cut / morph', 'Vật thể cảnh trước biến thành vật thể cảnh sau.', 'Giữ cùng vị trí và cỡ ở khung nối; đổi hình bằng SVG path morph hoặc crossfade 6 khung.', /match cut|biến hình|morph|biến thành|hóa thành/i],
    ['whip_pan', 'Lia nhanh', 'Whip pan', 'Máy quay lia vụt sang cảnh sau, kèm nhòe chuyển động.', 'translateX nhanh 200–260 ms + filter blur theo hướng.', /whip|lia nhanh|lia vụt/i],
    ['wipe', 'Quét phủ', 'Wipe', 'Một dải màu hoặc hình quét qua để đổi cảnh.', 'Khối màu thương hiệu chạy ngang hoặc chéo, đổi cảnh ở giữa đường quét.', /wipe|quét phủ|quét qua|dải màu/i],
    ['zoom_through', 'Phóng xuyên', 'Zoom-through', 'Máy quay lao vào một chi tiết để sang cảnh mới.', 'Scale cảnh trước 1→6 tại điểm đích, cảnh sau hiện từ 0.6→1.', /phóng xuyên|zoom.?through|lao vào|phóng vào|zoom vào|zoom-in/i],
    ['particles', 'Hạt và đốm sáng', 'Particles', 'Hạt bụi, đốm sáng, dữ liệu bay.', 'Canvas, số hạt cố định, vị trí tính từ seed và t (tất định).', /hạt|particle|đốm sáng|bụi sáng|tia sáng/i],
    ['glow_shine', 'Lóe sáng', 'Shine / glint', 'Vệt sáng quét qua logo, tem, bao bì.', 'Gradient trắng mờ chạy chéo qua phần tử, 500–700 ms.', /lóe|shine|glint|vệt sáng|ánh kim|lấp lánh/i],
    ['lower_third', 'Thanh tên', 'Lower third', 'Dải chữ tên người, địa điểm ở góc dưới.', 'Khối màu trượt vào, chữ theo sau 80 ms; giữ 2–3 s.', /lower third|thanh tên|dải tên|chú thích dưới/i],
    ['ui_demo', 'Mô phỏng giao diện', 'UI walkthrough', 'Màn hình app, con trỏ bấm, thẻ dữ liệu bật lên.', 'Dựng khung điện thoại/máy tính bằng HTML; con trỏ di theo đường cong; bấm thì gợn tròn.', /giao diện|màn hình app|con trỏ|bấm|cursor|dashboard|ui /i],
    ['map_route', 'Bản đồ và hành trình', 'Map / route', 'Bản đồ, điểm ghim, đường đi từ vườn tới nơi nhận.', 'SVG bản đồ đơn giản; ghim bật lò xo; đường nối vẽ nét.', /bản đồ|ghim|hành trình|map|route|lộ trình/i],
    ['chart_grow', 'Biểu đồ mọc', 'Chart grow', 'Cột, đường, vòng tròn tiến độ mọc lên.', 'Cột scaleY từ 0 với stagger; vòng tròn dùng stroke-dashoffset.', /biểu đồ|cột|chart|vòng tiến độ|thanh tiến độ|gantt/i],
    ['qr_scan', 'Quét QR', 'QR scan', 'Tem QR được quét, thông tin truy xuất bung ra.', 'Vạch quét chạy dọc tem, sau đó các thẻ dữ liệu bật ra lệch nhịp.', /qr|quét mã|tem truy xuất/i],
    ['3d_depth', 'Chiều sâu 3D', '3D depth', 'Lật thẻ, xoay hộp, khối nổi.', 'CSS perspective + rotateY/rotateX; WebGL chỉ khi thật cần.', /3d|webgl|xoay hộp|lật thẻ|perspective|chiều sâu/i],
    ['beat_sync', 'Khớp nhịp nhạc', 'Beat sync', 'Cắt cảnh và chữ dập đúng phách nhạc.', 'Lập bảng mốc phách (giây) trước; mọi cắt cảnh rơi vào mốc.', /nhịp nhạc|beat|theo nhạc|phách/i],
    ['loop', 'Vòng lặp liền', 'Seamless loop', 'Khung cuối nối khung đầu, dùng cho màn LED, ảnh động.', 'Mọi chuyển động là hàm tuần hoàn theo t với cùng chu kỳ.', /loop|lặp lại|vòng lặp|lặp liền/i],
    ['camera_live', 'Quay thật, máy quay', 'Live camera move', 'Flycam, cầm tay, cận cảnh macro trong cảnh quay thật hoặc video AI.', 'Ghi rõ chuyển động máy: dolly in, flycam lùi, cầm tay nhẹ, macro.', /flycam|drone|cầm tay|handheld|macro|dolly|cận cảnh|góc máy/i]
  ];
  const fxOf = t => FX.filter(f => f[5].test(String(t || ''))).map(f => f[0]);
  const MOTION_TIPS = [
    'Describe each beat with 5 cells: object, motion, layout, style, timing (HyperFrames).',
    'Write absolute timecodes ("leaves at 4.2s; at 4.2s the headline slams in") so layers never overlap.',
    'Keep one recurring object through the video (a leaf, the QR label, a gold line) to tie the story together.',
    'Frame 0 must already show content that reads on a phone.',
    'One strong object-based transition beats five unrelated effects; use at most 2–3 transition types per video.',
    'A change every 1–2 s, no dead time over 0.5 s; hold a deliberate pause 0.3–0.6 s before a reveal; headlines stay at least 1.2 s.',
    'Easing by function: tight spring for UI, smooth in-out for camera, controlled ease-out for logos. Avoid default bounce.',
    'Deterministic: no unseeded randomness; everything is a function of time t, so any frame can be re-rendered.',
    'Build and approve a still frame first, then animate and export.',
    'For AI video tools, describe the desired state ("camera holds still") instead of negatives ("no shake").',
    'Blurry text: fewer words per frame, split long sentences across scenes.',
    'Build in plain HTML/CSS/SVG/canvas; no Remotion, avoid GSAP. Export 16:9 and 9:16 from the same script.'
  ];
  function build(P, opt) {
    opt = opt || {};
    const TH = opt.tinhhuong || [], SB = opt.storyboard || [], CV = opt.cachviet || [];
    const KH = opt.khungs || {}, KHEN = opt.khungsEn || {};
    const DN = opt.dinhnghia || [], TR = opt.trans || [], MO = opt.motions || [];
    const fxMap = {}; P.forEach(p => { p._fx = p.kind === 'doc' ? [] : fxOf([p.name, p.dungcho, p.textVi || p.text, p.textEn].join(' ')); p._fx.forEach(f => (fxMap[f] = fxMap[f] || []).push(p.id)); });
    const sit = {};
    TH.forEach(t => t.buoc.forEach(b => String(b[1] || '').split(',').map(s => s.trim()).filter(Boolean).forEach(id => { (sit[id] = sit[id] || new Set()).add(t.id); })));
    const ids = new Set(P.map(p => p.id));
    const groups = {}; P.forEach(p => { const g = groups[p.group] = groups[p.group] || { id: p.group, name: p.groupName, count: 0, kinds: new Set() }; g.count++; g.kinds.add(p.kind); });
    return {
      schema: 'bvi-thu-vien-prompt/v1',
      title: 'Thư viện prompt BVI · FarmBase · Chiến dịch 10.000 ha',
      generated: opt.date || new Date().toISOString().slice(0, 10),
      scope: opt.scope || 'Toàn bộ thư viện',
      for_ai: {
        purpose: 'Reference library of prompt samples and motion information for BVI / FarmBase / the 10,000 ha campaign. Read it when the user asks for a video, image or document: take the prompt sample(s) that fit, fill the placeholders, append the matching frame, apply the motion_library (effects, transitions, tips) for videos, then produce the deliverable.',
        main_sections: ['prompts[] (prompt samples, the core)', 'motion_library (effects with how-to, transitions, motion styles, motion tips, glossary)', 'storyboard_templates[] and situations[] (ready-made sequences)', 'brand (rules to respect)'],
        how_to_use: [
          '1. Identify the deliverable kind: video, image or doc (proposal, profile, plan, quotation, letter, report...).',
          '2. Filter prompts by kind, then by projects (FarmBase, 10.000 ha, HTX, BVI, Sản phẩm nông sản), type and use_when; match keywords against the request. Check situations[] first: each lists ordered steps with prompt_ids for common jobs.',
          '3. Choose prompt_vi or prompt_en (prompt_en keeps on-screen Vietnamese copy, standard sentences and contact details in Vietnamese on purpose). For AI image/video tools (origin_language "en") prefer prompt_en.',
          '4. Fill every placeholder token from the user request; if a value is missing, ask the user instead of inventing it. Leave unknown values as the token.',
          '5. Append frames[kind] (same language) unless frame_recommended is false. For video, optionally append quality_check prompt ids SX-03 and SX-04.',
          '6. For video or motion work: read the prompt\'s motion tags, look them up in motion_library.effects (how_to says how to build each in HTML/CSS/canvas), pick transitions from motion_library.transitions, and follow motion_library.tips. To find samples by effect, use motion_library.effects[].prompt_ids.',
          '7. Respect brand.rules before delivering. For multi-scene videos, start from storyboard_templates[] and attach the referenced prompt per scene.'
        ],
        output_language: 'Deliverables are in Vietnamese unless the user asks otherwise.',
        selection_hint: 'Prefer one main prompt per deliverable; combine at most 3. When several fit, choose the one whose use_when is closest and whose formats match the requested aspect ratio.'
      },
      brand: {
        colors: { deep_green: '#084C46', leaf_green: '#35A576', bronze_gold: '#C9A227', background: '#F6F4EC' },
        font: 'Be Vietnam Pro',
        contact_default: 'Hotline BVI 0944 374 068 · @@EMAIL@@',
        standard_sentences: [
          'Giải pháp FarmBase do BVI và Salefronts đồng phát triển.',
          'Việc cấp mã số vùng trồng thuộc thẩm quyền cơ quan quản lý nhà nước; BVI hỗ trợ kỹ thuật, hồ sơ và vận hành hệ thống truy xuất.'
        ],
        rules: [
          'Only use the name FarmBase (never DurianBase).',
          'Never say FarmBase or BVI issues (cấp) growing-area or packing-facility codes; use the standard sentence.',
          'No FarmBase hectare, household or growing-area counts unless the user explicitly asks.',
          'Chiến dịch 10.000 ha is a proposal: every number is a target ("Mục tiêu đề xuất"); never show sponsorship costs in public content.',
          'GS1 and the packing-facility module are "dự kiến 11/2026"; national traceability sync only for areas that already have codes.',
          'No farmer personal data (names, ID numbers, phone numbers, land titles). No invented reviews, sales counts or partner logos.',
          'Press items use the label "Báo chí ghi nhận" with a "Nguồn:" line and link.',
          'Video: build in plain HTML/CSS/SVG/canvas; no Remotion (paid licence for companies over 3 people), avoid GSAP.',
          'Product photos: composite real photos with Claude; AI image tools only for backgrounds. Evidence-of-origin images must be real photos.'
        ]
      },
      frames: Object.fromEntries(Object.keys(KIND).map(k => [k, { vi: KH[k] || '', en: KHEN[k] || '' }])),
      quality_check: ids.has('sx-03') ? ['sx-03', 'sx-04'] : [],
      motion_library: {
        note: 'Motion vocabulary to use on request. Effects are tagged on prompts automatically from their text; use prompt_ids to find examples.',
        effects: FX.filter(f => fxMap[f[0]]).map(f => ({ id: f[0], name_vi: f[1], name_en: f[2], what: f[3], how_to: f[4], prompt_ids: fxMap[f[0]] })),
        transitions: TR,
        motion_styles: MO,
        tips: MOTION_TIPS,
        glossary: DN.map(d => ({ term: d.t, en: d.en || '', group: d.nhom || '', definition: d.dn || '', use: d.dung || '' }))
      },
      index: {
        count: P.length,
        kinds: Object.fromEntries(Object.keys(KIND).map(k => [k, P.filter(p => p.kind === k).length])),
        groups: Object.values(groups).map(g => ({ id: g.id, name: g.name, count: g.count, kinds: [...g.kinds] })),
        types: [...new Set(P.map(p => p.sub).filter(Boolean))],
        projects: [...new Set(P.flatMap(p => p.duan || []))]
      },
      prompts: P.map(p => ({
        id: p.id, kind: p.kind, kind_label: KIND[p.kind], group: p.group, group_name: p.groupName,
        type: p.sub || '', projects: p.duan || [], title: p.name,
        use_when: p.dungcho || '', original_idea: p.bangoc || '',
        formats: p.kho || [], tool: p.tool, keywords: keywords(p), motion: p._fx,
        origin_language: p.origEn ? 'en' : 'vi',
        frame_recommended: !['ai', 'sx', 'st'].includes(p.group),
        placeholders_vi: placeholders(p.textVi || p.text), placeholders_en: placeholders(p.textEn || ''),
        prompt_vi: p.textVi || p.text, prompt_en: p.textEn || '',
        situations: sit[p.id] ? [...sit[p.id]] : [],
        created: p.ngay || '', source: p.nguon || 'Prompt BVI tự viết', source_links: p.links || [],
        license: 'Bản viết mới của BVI, dùng tự do. Nguồn chỉ là ý tưởng; không chép nguyên văn prompt gốc.'
      })),
      situations: TH.map(t => ({ id: t.id, group: t.nhom, title: t.ten, when: t.khi, inputs: t.vao,
        steps: t.buoc.map(b => ({ task: b[0], prompt_ids: String(b[1] || '').split(',').map(s => s.trim()).filter(Boolean), tip: b[2] || '' })), tips: t.meo || [] })),
      writing_tips: CV.map(c => ({ for: c.loai, tips: c.y })),
      storyboard_templates: SB.map(m => ({ id: m.id, title: m.ten, type: m.loai, project: m.duan, duration_s: m.dur, format: m.kho, audience: m.dt, audio: m.am, goal: m.muc, keywords: m.tu,
        scenes: m.scenes.map(s => ({ relative_duration: s[0], prompt_id: s[1], visual: s[2], on_screen: s[3], voice: s[4], transition: s[5] })) }))
    };
  }
  root.buildAIJson = build;
  if (typeof module !== 'undefined') module.exports = build;
})(typeof window !== 'undefined' ? window : globalThis);
