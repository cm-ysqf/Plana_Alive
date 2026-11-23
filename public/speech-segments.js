// Sentence endings define turns of speech; commas only split unusually long sentences.
export function splitSpeech(text, limit = 60) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('语音分段长度无效');
  const chars = Array.from(text.trim()), sentences = [];
  let part = '';
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]; part += char;
    const decimal = char === '.' && /\d/.test(chars[i - 1] || '') && /\d/.test(chars[i + 1] || '');
    if (/[。！？!?；;\n]/u.test(char) || char === '.' && !decimal) {
      while (/[。！？!?.”’」』）)]/u.test(chars[i + 1] || '')) part += chars[++i];
      if (part.trim()) sentences.push(part.trim()); part = '';
    }
  }
  if (part.trim()) sentences.push(part.trim());
  return sentences.flatMap(sentence => {
    const remaining = Array.from(sentence), chunks = [];
    while (remaining.length) {
      let end = Math.min(limit, remaining.length);
      if (remaining.length > limit) {
        for (let i = end - 1; i >= Math.floor(limit / 3); i--) {
          if (/[、，,:：\s]/u.test(remaining[i])) { end = i + 1; break; }
        }
      }
      const chunk = remaining.splice(0, end).join('').trim();
      if (chunk) chunks.push(chunk);
    }
    return chunks;
  });
}

export function speechSegments(answer) {
  if (answer.segments?.length) return answer.segments;
  const speech = splitSpeech(answer.speech), reply = splitSpeech(answer.reply);
  // A legacy translation may change sentence count. Keep it together rather than misalign subtitles.
  if (speech.length !== reply.length) return [{ reply: answer.reply, speech: answer.speech }];
  return speech.map((text, i) => ({ reply: reply[i], speech: text }));
}

export function speechPause(text) {
  return /[?？][”’」』）)]*$/u.test(text.trim()) ? 480 : /[…][”’」』）)]*$/u.test(text.trim()) ? 600 : 320;
}

export function waitForSpeech(ms, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(new DOMException('已取消', 'AbortError')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}
