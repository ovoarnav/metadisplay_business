// Deterministic speech formatting only. No LLM guesses or automatic confirmation.
const symbols = { at: '@', dot: '.', period: '.', underscore: '_', dash: '-', hyphen: '-', plus: '+',
    zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9' };
const literal = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
export function recipientCandidate(raw) {
    if (typeof raw !== 'string' || raw.length > 1500 || /[\r\n]/.test(raw))
        return null;
    const input = raw.trim();
    if (input.length <= 254 && literal.test(input))
        return input;
    // Spaces and these explicit spoken symbols/digits may be joined; every other
    // word remains literal. Never guess b/v, a missing letter, provider or domain.
    const words = input.toLowerCase().replace(/[,!?;:]/g, ' ').trim().split(/\s+/);
    const candidate = words.map(word => symbols[word] ?? word).join('');
    return candidate.length <= 254 && literal.test(candidate) ? candidate : null;
}
export function captureRecipient(prior, text, epoch, now) {
    // A deliberately bounded recipient-entry phrase, separate from normal notes.
    // Incomplete domains never appear as a confirmable address before the end cue.
    let capture = prior && prior.epoch === epoch && now - prior.startedAt <= 90_000 ? structuredClone(prior)
        : { epoch, startedAt: now, fragments: [], started: false };
    const input = [...capture.fragments, text].join(' ');
    const start = /\b(?:my email(?: address)? is|recipient email(?: address)? is)\b/i.exec(input);
    if (start)
        capture = { epoch, startedAt: now, fragments: [input.slice(start.index + start[0].length)], started: true };
    else if (capture.started)
        capture.fragments.push(text);
    else
        return { capture: { ...capture, fragments: [input.slice(-160)] } };
    const all = capture.fragments.join(' ');
    if (all.length > 1500 || capture.fragments.length > 50)
        return { completed: true };
    const finish = /\bemail complete\b/i.exec(all);
    if (!finish)
        return { capture };
    // Sentence punctuation after a spelled address is transcription decoration;
    // preserve dots inside the address and require a complete explicit domain.
    const raw = all.slice(0, finish.index).trim().replace(/[.,!?;:]+$/, '');
    const candidate = recipientCandidate(raw);
    return { completed: true, ...(candidate ? { candidate } : {}) };
}
