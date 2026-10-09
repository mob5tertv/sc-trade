// The feedback form of the page: shows it (without a script the page says where to write instead), checks a message
// with the rules of feedback-rules.js, sends it, shows how far the sending has gone, and says what happened in the
// language of the page. Whatever goes wrong, what the visitor typed stays in the form.
import { checkFeedback, countChars, LIMITS, progressPercent, readReply } from './feedback-rules.js';

const SEND_TIMEOUT_MS = 120000;

function startFeedback() {
  const form = /** @type {HTMLFormElement | null} */ (document.querySelector('[data-feedback]'));
  const done = /** @type {HTMLElement | null} */ (document.querySelector('[data-feedback-done]'));
  if (form === null || done === null) return;

  const field = (/** @type {string} */ name) => /** @type {HTMLInputElement} */ (form.querySelector(`[name="${name}"]`));
  const message = /** @type {HTMLTextAreaElement} */ (form.querySelector('[name="message"]'));
  const contact = field('contact');
  const shots = field('shots[]');
  const log = field('log');
  const started = field('started');
  const errorBox = /** @type {HTMLElement} */ (form.querySelector('[data-feedback-error]'));
  const progress = /** @type {HTMLElement} */ (form.querySelector('[data-feedback-progress]'));
  const progressBar = /** @type {HTMLProgressElement} */ (progress.querySelector('progress'));
  const progressText = /** @type {HTMLElement} */ (form.querySelector('[data-feedback-progress-text]'));
  const count = /** @type {HTMLElement} */ (form.querySelector('[data-feedback-count]'));
  const submit = /** @type {HTMLButtonElement} */ (form.querySelector('[type="submit"]'));
  let sending = false;

  /** The form is on the screen from this moment: the server reads the time to tell a person from a robot. */
  const show = () => {
    started.value = String(Date.now());
    form.hidden = false;
    done.hidden = true;
  };

  const clearError = () => {
    errorBox.hidden = true;
    errorBox.textContent = '';
    for (const input of [message, contact, shots, log]) input.removeAttribute('aria-invalid');
  };

  /** @param {import('./feedback-rules.js').ErrorCode} code @param {boolean} fromServer */
  const showError = (code, fromServer) => {
    errorBox.textContent = form.getAttribute(`data-error-${code}`) ?? form.getAttribute('data-error-server') ?? '';
    errorBox.hidden = false;
    // a refusal of the page itself points at the field that caused it; an answer of the server may be about any
    if (fromServer) return;
    const culprit = code === 'too_short' ? message : code === 'too_long' ? (countChars(contact.value.trim()) > LIMITS.contactMax ? contact : message) : null;
    if (culprit !== null) {
      culprit.setAttribute('aria-invalid', 'true');
      culprit.focus();
    }
  };

  const setSending = (/** @type {boolean} */ on) => {
    sending = on;
    submit.disabled = on;
    progress.hidden = !on;
    if (on) {
      progressBar.value = 0;
      progressText.textContent = `${form.getAttribute('data-sending') ?? ''} 0%`;
    }
  };

  const updateCount = () => {
    count.textContent = `${countChars(message.value.trim())} / ${LIMITS.messageMax}`;
  };
  message.addEventListener('input', updateCount);
  updateCount();

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (sending) return;
    clearError();
    const chosenShots = Array.from(shots.files ?? []);
    const chosenLogs = Array.from(log.files ?? []);
    const problem = checkFeedback({ message: message.value, contact: contact.value, shots: chosenShots, logs: chosenLogs });
    if (problem !== null) return showError(problem, false);

    // built by hand: a file field with nothing chosen sends nothing at all
    const body = new FormData();
    body.append('message', message.value);
    body.append('contact', contact.value);
    body.append('lang', field('lang').value);
    body.append('website', field('website').value);
    body.append('started', started.value);
    for (const file of chosenShots) body.append('shots[]', file, file.name);
    for (const file of chosenLogs) body.append('log', file, file.name);

    const request = new XMLHttpRequest();
    request.open('POST', form.getAttribute('action') ?? '');
    request.timeout = SEND_TIMEOUT_MS;
    request.upload.addEventListener('progress', (step) => {
      if (!step.lengthComputable) return;
      const percent = progressPercent(step.loaded, step.total);
      progressBar.value = percent;
      progressText.textContent = `${form.getAttribute('data-sending') ?? ''} ${percent}%`;
    });
    const fail = () => {
      setSending(false);
      showError('server', true);
    };
    request.addEventListener('error', fail);
    request.addEventListener('timeout', fail);
    request.addEventListener('abort', fail);
    request.addEventListener('load', () => {
      setSending(false);
      const reply = readReply(request.status, request.responseText);
      if (!reply.ok) return showError(reply.error, true);
      form.reset();
      updateCount();
      form.hidden = true;
      done.hidden = false;
      done.focus();
    });
    setSending(true);
    request.send(body);
  });

  const again = done.querySelector('[data-feedback-again]');
  if (again !== null) {
    again.addEventListener('click', () => {
      show();
      message.focus();
    });
  }

  show();
}

startFeedback();
