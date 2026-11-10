/* 공용 음성 읽기(TTS) 모듈 — 모바일 대응
 * - 앱 속 브라우저(카카오톡 등) 감지 → 외부 브라우저로 열기 안내
 * - iOS: 첫 터치 때 음성 엔진 깨우기, 무음 스위치 안내
 * - 크롬 안드로이드: 긴 문장 쪼개기, cancel 직후 speak 씹힘 방지, 일시정지 상태 해제
 * 사용: TTS.speak(text, {pitch, onend}) / TTS.say(text, opts) / TTS.cancel()
 */
(function () {
  const synth = window.speechSynthesis || null;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const isKakao = /KAKAOTALK/i.test(ua);
  const inApp = isKakao || /NAVER\(|DaumApps|Instagram|FBAN|FBAV|Line\/|everytimeApp|Whale\/.*inapp|; wv\)/i.test(ua);

  let voice = null, started = false, warned = false, unlocked = false;
  const keep = []; // 크롬에서 utterance가 GC되어 onend가 안 오는 문제 방지

  function pickVoice() {
    if (!synth) return;
    const vs = synth.getVoices().filter(v => /^en[-_]/i.test(v.lang));
    voice = vs.find(v => /en[-_]US/i.test(v.lang) && /Google|Natural|Online|Samantha/i.test(v.name))
         || vs.find(v => /en[-_]US/i.test(v.lang)) || vs[0] || null;
  }
  if (synth) {
    pickVoice();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', pickVoice);
    else synth.onvoiceschanged = pickVoice;
  }

  const rate = () => { const el = document.getElementById('rate'); return el ? (parseFloat(el.value) || 0.85) : 0.85; };

  /* 긴 글은 문장 단위로 (크롬 안드로이드는 약 200자 넘으면 끊김) */
  function chunks(text) {
    const clean = String(text).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
    const sents = clean.match(/[^.!?]+[.!?]*["']?\s*/g) || [clean];
    const out = []; let cur = '';
    sents.forEach(s => {
      if ((cur + s).length > 160 && cur) { out.push(cur.trim()); cur = ''; }
      cur += s;
    });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }

  /* iOS 등: 첫 터치 때 무음 발화로 엔진 깨우기 */
  function unlock() {
    if (unlocked || !synth) return;
    unlocked = true;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0; u.lang = 'en-US';
      synth.speak(u);
    } catch (e) {}
  }
  ['touchend', 'pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, unlock, { once: true, capture: true }));

  /* 정지(cancel) 직후 바로 말하면 크롬/안드로이드에서 씹힘 → 잠깐 모았다가 순서대로 */
  let lastCancel = 0, deferred = [], flushTimer = null;
  function speak(text, opts) {
    if (!synth) { showBanner('nosupport'); return; }
    const wait = 150 - (Date.now() - lastCancel);
    if (wait > 0) {
      deferred.push([text, opts]);
      if (!flushTimer) flushTimer = setTimeout(() => {
        flushTimer = null; const q = deferred; deferred = [];
        q.forEach(([t, o]) => speakNow(t, o));
      }, wait);
      return;
    }
    speakNow(text, opts);
  }
  function speakNow(text, opts) {
    opts = opts || {};
    const parts = chunks(text);
    if (!parts.length) return;
    if (!voice) pickVoice();
    parts.forEach((p, i) => {
      const u = new SpeechSynthesisUtterance(p);
      u.lang = 'en-US';
      if (voice) u.voice = voice;
      u.rate = rate();
      u.pitch = opts.pitch || 1;
      const done = () => { const k = keep.indexOf(u); if (k >= 0) keep.splice(k, 1); };
      u.onstart = () => { started = true; hideBanner(); };
      u.onend = () => { done(); if (i === parts.length - 1 && opts.onend) opts.onend(); };
      u.onerror = e => {
        done();
        // 중지(cancel)로 끊긴 경우엔 다음 동작을 이어 가지 않음
        if (e && (e.error === 'interrupted' || e.error === 'canceled')) return;
        if (i === parts.length - 1 && opts.onend) opts.onend();
      };
      keep.push(u);
      synth.speak(u);
    });
    if (synth.paused) synth.resume();
    if (!started && !warned) {
      setTimeout(() => {
        if (!started && !synth.speaking) { warned = true; showBanner('silent'); }
      }, 2500);
    }
  }

  function cancel() {
    deferred = []; if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (synth && (synth.speaking || synth.pending)) { synth.cancel(); lastCancel = Date.now(); }
    keep.length = 0;
  }

  function say(text, opts) { cancel(); speak(text, opts); }

  /* ---------- 안내 배너 ---------- */
  let banner = null;
  function openExternal() {
    const url = location.href;
    if (isKakao) { location.href = 'kakaotalk://web/openExternal?url=' + encodeURIComponent(url); return; }
    if (isAndroid) { location.href = 'intent://' + url.replace(/^https?:\/\//, '') + '#Intent;scheme=https;package=com.android.chrome;end'; return; }
    copyLink();
  }
  function copyLink() {
    const done = () => { const m = banner && banner.querySelector('.tts-msg2'); if (m) m.textContent = '주소를 복사했어요. 사파리나 크롬 주소창에 붙여 넣으세요.'; };
    if (navigator.clipboard) navigator.clipboard.writeText(location.href).then(done, () => prompt('이 주소를 복사하세요', location.href));
    else prompt('이 주소를 복사하세요', location.href);
  }
  function showBanner(kind) {
    if (!document.body) return;
    hideBanner();
    banner = document.createElement('div');
    banner.setAttribute('role', 'alert');
    banner.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#1f2937;color:#fff;border-radius:14px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.3);font-size:.95rem;line-height:1.5;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif;max-width:640px;margin:0 auto';
    let msg;
    if (kind === 'nosupport' || inApp) {
      msg = '<b>🔇 이 화면에서는 소리가 나오지 않아요.</b><br>' +
            (inApp ? '카카오톡 같은 앱 안에서 열면 음성이 지원되지 않아요. ' : '이 브라우저는 음성 읽기를 지원하지 않아요. ') +
            (isIOS ? '<b>사파리</b>로 열어 주세요.' : '<b>크롬</b>으로 열어 주세요.');
    } else {
      msg = '<b>🔇 소리가 안 들리나요?</b><br>' +
            (isIOS ? '① 아이폰 옆의 <b>무음 스위치</b>를 꺼 주세요 (주황색이 안 보이게)<br>② 볼륨을 올려 주세요<br>③ 그래도 안 되면 <b>사파리</b>로 열어 주세요'
                   : '① 볼륨(미디어 소리)을 올려 주세요<br>② 그래도 안 되면 <b>크롬</b>으로 열어 주세요<br>③ 설정 → 텍스트 음성 변환(TTS)에서 영어 음성을 설치해 주세요');
    }
    banner.innerHTML = msg + '<div class="tts-msg2" style="margin-top:6px;color:#fdba74"></div>' +
      '<div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">' +
      ((inApp || kind === 'nosupport') ? '<button data-a="open" style="background:#f97316;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-size:.95rem">' + (isIOS && !isKakao ? '🔗 주소 복사' : '🌐 다른 브라우저로 열기') + '</button>' : '') +
      '<button data-a="close" style="background:#374151;color:#fff;border:0;border-radius:10px;padding:8px 14px;font-size:.95rem">닫기</button></div>';
    banner.querySelector('[data-a="close"]').onclick = hideBanner;
    const o = banner.querySelector('[data-a="open"]');
    if (o) o.onclick = () => (isIOS && !isKakao) ? copyLink() : openExternal();
    document.body.appendChild(banner);
  }
  function hideBanner() { if (banner) { banner.remove(); banner = null; } }

  // 음성 기능이 아예 없거나, 안드로이드 앱 속 브라우저면 미리 안내
  document.addEventListener('DOMContentLoaded', () => {
    if (!synth || (inApp && isAndroid)) showBanner('nosupport');
  });

  window.TTS = { speak, say, cancel, supported: !!synth };
})();
