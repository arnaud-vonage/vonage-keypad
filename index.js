import path from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { tokenGenerate } from '@vonage/jwt';

const projectDirectory = path.dirname(fileURLToPath(import.meta.url));
const localMode = process.env.LOCAL_MODE === 'true';
let createVonageToken;
let configuredPrivateKey;

if (localMode) {
    const applicationId = process.env.API_APPLICATION_ID;
    const requiredVariables = [
        'API_ACCOUNT_ID',
        'API_ACCOUNT_SECRET',
        'API_APPLICATION_ID',
        'BASIC_AUTH_USERNAME',
        'BASIC_AUTH_PASSWORD',
    ];
    const missingVariables = requiredVariables.filter((name) => !process.env[name]);

    if (!process.env.PRIVATE_KEY_PATH && !process.env.PRIVATE_KEY) missingVariables.push('PRIVATE_KEY_PATH');
    if (missingVariables.length) {
        throw new Error(`Local configuration missing: ${missingVariables.join(', ')}. Copy .env.example to .env and fill in the values.`);
    }

    configuredPrivateKey = process.env.PRIVATE_KEY_PATH
        ? await readFile(path.resolve(projectDirectory, process.env.PRIVATE_KEY_PATH))
        : process.env.PRIVATE_KEY;

    createVonageToken = ({ subject, aclPaths, exp }) => tokenGenerate(applicationId, configuredPrivateKey, {
        subject,
        acl: aclPaths ? { paths: aclPaths } : undefined,
        exp,
    });
} else {
    const { vcr, Voice } = await import('@vonage/vcr-sdk');
    const session = vcr.createSession();
    const voice = new Voice(session);

    await voice.onCall('answer');
    await voice.onCallEvent({ callback: 'event' });
    createVonageToken = (params) => vcr.createVonageToken(params);
}

const app = express();
const port = process.env.PORT || process.env.VCR_PORT || 3000;
const publicDirectory = path.join(projectDirectory, 'public');
const clientUsername = 'keypad-user';
const clientRegion = 'AP';
const userApiUrls = {
    AP: 'https://api-ap-3.vonage.com',
    EU: 'https://api-eu-3.vonage.com',
    US: 'https://api-us-3.vonage.com',
};
let clientUserPromise;
let ownedNumbersCache;

app.set('trust proxy', true);
app.use(express.json());

app.get('/_/health', (_req, res) => res.sendStatus(200));

app.use((req, res, next) => {
    if (req.path === '/answer' || req.path === '/event') return next();

    const username = process.env.BASIC_AUTH_USERNAME || process.env.USERNAME;
    const password = process.env.BASIC_AUTH_PASSWORD || process.env.PASSWORD;
    const credentials = parseBasicCredentials(req.get('authorization'));

    if (username && password
        && safeEqual(credentials.username, username)
        && safeEqual(credentials.password, password)) return next();

    res.set('WWW-Authenticate', 'Basic realm="Vonage Keypad", charset="UTF-8"');
    return res.status(401).send('Authentication required.');
});

app.use(express.static(publicDirectory));

function parseBasicCredentials(authorization = '') {
    if (!authorization.startsWith('Basic ')) return {};
    try {
        const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) return {};
        return {
            username: decoded.slice(0, separator),
            password: decoded.slice(separator + 1),
        };
    } catch {
        return {};
    }
}

function safeEqual(actual = '', expected = '') {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length
        && timingSafeEqual(actualBuffer, expectedBuffer);
}

app.get('/numbers', async (_req, res) => {
    try {
        const numbers = await getOwnedNumbers();
        res.json({
            numbers,
            defaultNumber: numbers[0]?.msisdn || '',
        });
    } catch (error) {
        res.status(502).json({ error: error.message });
    }
});

app.get('/session', async (_req, res) => {
    res.set('Cache-Control', 'no-store');
    const applicationId = process.env.API_APPLICATION_ID;
    const privateKey = configuredPrivateKey || process.env.PRIVATE_KEY;

    if (!applicationId || !privateKey)
        return res.status(503).json({ error: 'VCR credentials are not configured.' });

    try {
        clientUserPromise ||= provisionClientUser(clientUsername, userApiUrls[clientRegion]);
        await clientUserPromise;
    } catch (error) {
        clientUserPromise = undefined;
        return res.status(502).json({ error: error.message });
    }

    const acl = {
        '/*/users/**': {},
        '/*/conversations/**': {},
        '/*/sessions/**': {},
        '/*/devices/**': {},
        '/*/image/**': {},
        '/*/media/**': {},
        '/*/push/**': {},
        '/*/knocking/**': {},
        '/*/legs/**': {},
    };

    const jwt = createVonageToken({
        subject: clientUsername,
        aclPaths: acl,
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
    });

    res.json({ jwt, region: clientRegion });
});

async function provisionClientUser(username, apiUrl) {
    const adminJwt = createVonageToken({
        exp: Math.floor(Date.now() / 1000) + 15 * 60,
    });
    const response = await fetch(`${apiUrl}/v1/users`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${adminJwt}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify({ name: username, display_name: 'Keypad User' }),
    });

    if (response.ok) return;

    const message = await response.text();
    let errorCode;
    try {
        errorCode = JSON.parse(message).code;
    } catch {}

    if (errorCode === 'user:error:duplicate-name') return;

    throw new Error(`Unable to provision Client SDK user (${response.status}): ${message}`);
}

function normalizeNumber(value) {
    return String(value || '').replace(/[^\d]/g, '');
}

async function fetchOwnedNumbers() {
    const apiKey = process.env.API_ACCOUNT_ID;
    const apiSecret = process.env.API_ACCOUNT_SECRET;
    if (!apiKey || !apiSecret) throw new Error('VCR account credentials are not configured.');

    const authorization = `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString('base64')}`;
    const numbers = [];
    const pageSize = 100;
    let index = 1;
    let total = 0;

    do {
        const url = new URL('https://rest.nexmo.com/account/numbers');
        url.searchParams.set('index', String(index));
        url.searchParams.set('size', String(pageSize));
        const response = await fetch(url, { headers: { authorization } });
        if (!response.ok) {
            const message = await response.text();
            throw new Error(`Unable to fetch owned numbers (${response.status}): ${message}`);
        }

        const page = await response.json();
        total = Number(page.count || 0);
        numbers.push(...(page.numbers || []).map(({ country, msisdn, type, features }) => ({
            country,
            msisdn: normalizeNumber(msisdn),
            type,
            features,
        })));
        index += 1;
    } while (numbers.length < total);

    return numbers;
}

async function getOwnedNumbers() {
    if (!ownedNumbersCache || ownedNumbersCache.expiresAt < Date.now()) {
        ownedNumbersCache = {
            expiresAt: Date.now() + 5 * 60 * 1000,
            promise: fetchOwnedNumbers(),
        };
    }
    return ownedNumbersCache.promise;
}

function getCallContext(body) {
    const customData = body?.custom_data ?? body?.customData;
    if (!customData) return {};
    if (typeof customData === 'object') return customData;
    try {
        return JSON.parse(customData);
    } catch {
        return {};
    }
}

app.post('/answer', async (req, res) => {
    const context = getCallContext(req.body);
    const number = normalizeNumber(context.to);

    if (!number) {
        console.log('/answer inbound call rejected', {
            from: normalizeNumber(req.body?.from),
            to: normalizeNumber(req.body?.to),
        });
        return res.json([
            { action: 'talk', text: 'The operators cannot be joined at this number.' },
        ]);
    }

    const callerId = normalizeNumber(context.from);
    let ownedNumbers;
    try {
        ownedNumbers = await getOwnedNumbers();
    } catch (error) {
        console.error('/answer unable to validate caller ID:', error.message);
        return res.json([{ action: 'talk', text: 'This call could not be connected.' }]);
    }

    const isOwnedCallerId = ownedNumbers.some(({ msisdn }) => msisdn === callerId);

    if (!callerId || !isOwnedCallerId) {
        console.error('/answer rejected unowned caller ID', { callerId });
        return res.json([
            { action: 'talk', text: 'This call could not be connected.' },
        ]);
    }

    console.log(`/answer connecting ${callerId} -> ${number}`);

    res.json([
        {
            action: 'connect',
            from: callerId,
            endpoint: [{ type: 'phone', number }],
        },
    ]);
});

app.post('/event', (req, res) => {
    const { uuid, conversation_uuid: conversationId, status, detail, sip_code: sipCode } = req.body;
    console.log('/event', { uuid, conversationId, status, detail, sipCode });
    res.sendStatus(204);
});

app.listen(port, '0.0.0.0', () => {
    console.log(`Listening on port ${port} (${localMode ? 'local' : 'VCR'} mode)`);
});