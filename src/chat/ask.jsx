// Ask Jarvis: a chat that answers from the numbers on the page, with optional voice in and out.

import { useState, useRef, useEffect } from 'preact/hooks';
import { Drawer, Button, Banner, Icon } from '../ui/kit.jsx';
import { ask, explainAiError, aiLimits } from '../platform/ai.js';
import { speak, stopSpeaking, canSpeak, canListen, startListening, stopListening, onDictation, onSpeakState } from '../platform/voice.js';
import { rules, digest, buildTools } from './context.js';
import { getState } from '../app/store.js';
import { REGISTER_BY_KEY } from '../registers/schemas.js';

const STARTERS = ['What should I deal with first today?', 'Who owes me money and who should I call?', 'Which job worries you most, and why?', 'What can you not see about my businesses, and what should I fix first?', 'Walk me through the next four weeks of cash.'];

export function AskDrawer({ state, actions, seed, onClose }) {
  const [turns, setTurns] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState('');
  const [note, setNote] = useState('');
  const [hidden, setHidden] = useState(false);
  const [toolsOk, setToolsOk] = useState(true);
  const [listening, setListening] = useState(false);
  const [partial, setPartial] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const [drafts, setDrafts] = useState([]);
  const ctl = useRef(null);
  const endRef = useRef(null);
  const seeded = useRef(false);

  useEffect(() => {
    aiLimits().then((l) => setToolsOk(l.tools > 0));
    const offD = onDictation({
      partial: (t) => setPartial(t),
      final: (t) => setText((prev) => (prev ? prev + t : t.replace(/^\s+/, ''))),
      state: (s) => {
        setListening(s !== 'idle');
        if (s === 'idle') setPartial('');
      },
    });
    const offS = onSpeakState((s) => setSpeaking(s !== 'idle'));
    return () => {
      offD();
      offS();
      if (ctl.current) ctl.current.abort();
      stopListening();
    };
  }, []);
  useEffect(() => {
    if (endRef.current && endRef.current.scrollIntoView) endRef.current.scrollIntoView({ block: 'end' });
  }, [turns, live]);

  const send = async (question) => {
    const q = String(question || '').trim();
    if (!q || busy) return;
    setNote('');
    setText('');
    const history = [...turns, { role: 'user', content: q }];
    setTurns(history);
    setBusy(true);
    setLive('');
    ctl.current = new AbortController();
    const st = getState();
    const brief = `${rules(st.settings.profile)}\n\nCURRENT NUMBERS (already worked out by the page; trust these over anything else):\n${digest(st)}`;
    // Keep the instructions turn and the most recent exchanges; older ones fall away.
    const recent = history.slice(-10);
    while (recent.length && recent[0].role !== 'user') recent.shift();
    const input = [{ role: 'user', content: brief }, ...recent];
    const tools = toolsOk ? buildTools(getState, (list, data) => setDrafts((d) => [...d, { id: `${Date.now()}${d.length}`, list, data }])) : undefined;
    const res = await ask(input, { tools, cache: tools ? undefined : false, signal: ctl.current.signal, onText: (t) => setLive(t) });
    setBusy(false);
    setLive('');
    if (res.ok) {
      setTurns([...history, { role: 'assistant', content: res.text }]);
      if (res.truncated) setNote('That answer was cut short. Ask for less at a time.');
    } else {
      const e = explainAiError(res.code);
      if (res.text && res.code !== 'refused') setTurns([...history, { role: 'assistant', content: `${res.text}\n\n(interrupted)` }]);
      else if (res.code === 'cancelled') setTurns(history);
      if (e.hide) setHidden(true);
      if (!e.silent) setNote(e.text);
    }
  };

  useEffect(() => {
    if (seed && !seeded.current) {
      seeded.current = true;
      send(seed);
    }
  }, [seed]);

  const lastAnswer = [...turns].reverse().find((t) => t.role === 'assistant');
  const mic = () => {
    if (listening) {
      stopListening();
      return;
    }
    // Must be called straight from the click.
    startListening().then((r) => {
      if (!r.ok && r.code !== 'stopped' && r.code !== 'dismissed') setNote(r.hide ? 'Dictation is switched off for this page.' : 'The microphone could not start. You can still type.');
    });
  };

  return (
    <Drawer title="Ask Jarvis" onClose={onClose} wide footer={
      <form class="chat__input" onSubmit={(e) => { e.preventDefault(); send(text); }}>
        <textarea id="ask-input" data-autofocus placeholder={listening ? 'Listening…' : 'Ask about cash, a job, a customer, or tell Jarvis something to record'} value={listening && partial ? `${text}${partial}` : text} onInput={(e) => setText(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(text); } }} disabled={hidden} />
        {canListen() && <Button icon={listening ? 'stop' : 'mic'} onClick={mic} aria-label={listening ? 'Stop dictation' : 'Dictate'} aria-pressed={String(listening)} disabled={hidden} />}
        {busy ? <Button icon="stop" onClick={() => ctl.current && ctl.current.abort()}>Stop</Button> : <Button kind="primary" icon="send" type="submit" disabled={hidden || !text.trim()}>Ask</Button>}
      </form>
    }>
      {hidden ? (
        <Banner kind="warn">{note || 'Asking Jarvis is not available in this view.'}</Banner>
      ) : (
        <>
          {!turns.length && (
            <div class="stack">
              <p class="muted" style={{ fontSize: 'var(--t-sm)', maxWidth: '60ch' }}>Jarvis answers from the numbers on this page and from your own records. It runs on your Claude account, so the first question asks your permission.{toolsOk ? '' : ' This view cannot look things up live, so answers use the summary only.'}</p>
              <div class="chips">
                {STARTERS.map((s) => (
                  <button type="button" class="chip" key={s} onClick={() => send(s)}>{s}</button>
                ))}
              </div>
            </div>
          )}
          <div class="chat" aria-live="polite">
            {turns.map((t, i) => (
              <div key={i} class={`msg msg--${t.role === 'user' ? 'you' : 'jarvis'}`}>
                <span class="msg__who">{t.role === 'user' ? 'You' : 'Jarvis'}</span>
                {t.content}
              </div>
            ))}
            {busy && (
              <div class="msg msg--jarvis">
                <span class="msg__who">Jarvis</span>
                {live || 'Thinking…'}
              </div>
            )}
            <div ref={endRef} />
          </div>
          {drafts.map((d) => {
            const schema = REGISTER_BY_KEY[d.list];
            return (
              <div class="banner banner--info" key={d.id}>
                <span class="grow">Jarvis drafted a new {schema.singular} for your {schema.title.toLowerCase()}: <strong>{schema.describe(d.data) || Object.values(d.data)[0]}</strong>. Nothing is saved until you review it.</span>
                <Button small kind="primary" onClick={() => { setDrafts((x) => x.filter((y) => y.id !== d.id)); actions.openRegister(d.list, { preset: d.data }); }}>Review and save</Button>
                <Button small kind="ghost" onClick={() => setDrafts((x) => x.filter((y) => y.id !== d.id))}>Discard</Button>
              </div>
            );
          })}
          {note && <Banner kind="warn">{note}</Banner>}
          {lastAnswer && canSpeak() && !busy && (
            <div class="row">
              {speaking ? <Button small icon="stop" onClick={() => stopSpeaking()}>Stop reading</Button> : <Button small icon="speaker" onClick={async () => { const r = await speak(lastAnswer.content); if (!r.ok && r.code !== 'stopped') setNote(r.hide ? 'Reading aloud is switched off for this page.' : 'Could not read that aloud just now.'); }}>Read the answer aloud</Button>}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
