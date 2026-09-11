import { VonageClient } from '@vonage/client-sdk';

let client;
const numberInput = document.querySelector('#phone-number');
const fromNumberSelect = document.querySelector('#from-number');
const callButton = document.querySelector('#call-button');
const statusText = document.querySelector('#status-text');
const keypad = document.querySelector('#keypad');
const backspaceButton = document.querySelector('#backspace');

let activeCallId = null;
let sessionReady = false;

function setStatus(message, state = 'idle') {
    statusText.textContent = message;
    statusText.dataset.state = state;
}

function setCalling(isCalling) {
    callButton.classList.toggle('is-active', isCalling);
    callButton.setAttribute('aria-label', isCalling ? 'End call' : 'Call number');
    callButton.querySelector('span').textContent = isCalling ? 'End call' : 'Call';
    numberInput.disabled = isCalling;
    fromNumberSelect.disabled = isCalling;
    keypad.querySelectorAll('button').forEach((button) => button.disabled = isCalling);
}

function finishCall(message = 'Call ended') {
    activeCallId = null;
    setCalling(false);
    setStatus(message, 'idle');
}

function appendDigit(digit) {
    if (numberInput.disabled || numberInput.value.length >= 15) return;
    numberInput.value += digit;
    numberInput.dispatchEvent(new Event('input'));
}

async function startSession() {
    try {
        setStatus('Connecting...', 'pending');
        const [sessionResponse, numbersResponse] = await Promise.all([
            fetch('/session'),
            fetch('/numbers'),
        ]);
        const [body, numbersBody] = await Promise.all([
            sessionResponse.json(),
            numbersResponse.json(),
        ]);
        if (!sessionResponse.ok) throw new Error(body.error || 'Unable to create a session.');
        if (!numbersResponse.ok) throw new Error(numbersBody.error || 'Unable to load owned numbers.');
        if (!numbersBody.numbers.length) throw new Error('No owned numbers are available.');

        fromNumberSelect.replaceChildren(...numbersBody.numbers.map(({ msisdn, country }) => {
            const option = document.createElement('option');
            option.value = msisdn;
            option.textContent = `+${msisdn}${country ? ` (${country})` : ''}`;
            option.selected = msisdn === numbersBody.defaultNumber;
            return option;
        }));
        fromNumberSelect.disabled = false;

        client = new VonageClient({ region: body.region });
        client.on('callHangup', (callId) => {
            if (callId === activeCallId) finishCall();
        });
        client.on('sessionError', () => {
            sessionReady = false;
            callButton.disabled = true;
            setStatus('Connection lost. Reload to reconnect.', 'error');
        });
        await client.createSession(body.jwt);
        sessionReady = true;
        callButton.disabled = !numberInput.value || !fromNumberSelect.value;
        setStatus('Ready', 'ready');
    } catch (error) {
        setStatus(error.message, 'error');
    }
}

async function toggleCall() {
    if (activeCallId) {
        try {
            await client.hangup(activeCallId);
        } finally {
            finishCall();
        }
        return;
    }

    const number = numberInput.value.replace(/\D/g, '');
    const from = fromNumberSelect.value;
    if (!sessionReady || !number || !from) return;

    try {
        setStatus('Calling...', 'pending');
        callButton.disabled = true;
        activeCallId = await client.serverCall({ to: number, from });
        setCalling(true);
        callButton.disabled = false;
        setStatus('In call', 'active');
    } catch (error) {
        activeCallId = null;
        setCalling(false);
        callButton.disabled = false;
        setStatus(error.message || 'Call failed', 'error');
    }
}

keypad.addEventListener('click', (event) => {
    const button = event.target.closest('[data-digit]');
    if (button) appendDigit(button.dataset.digit);
});

backspaceButton.addEventListener('click', () => {
    numberInput.value = numberInput.value.slice(0, -1);
    numberInput.dispatchEvent(new Event('input'));
    numberInput.focus();
});

numberInput.addEventListener('input', () => {
    numberInput.value = numberInput.value.replace(/\D/g, '').slice(0, 15);
    callButton.disabled = !sessionReady || !numberInput.value || !fromNumberSelect.value;
});

fromNumberSelect.addEventListener('change', () => {
    callButton.disabled = !sessionReady || !numberInput.value || !fromNumberSelect.value;
});

document.addEventListener('keydown', (event) => {
    if (/^\d$/.test(event.key)) {
        if (event.target === numberInput) return;
        event.preventDefault();
        appendDigit(event.key);
    }
    if (event.key === 'Enter' && !callButton.disabled) toggleCall();
    if (event.key === 'Escape' && activeCallId) toggleCall();
});

callButton.addEventListener('click', toggleCall);

startSession();