import WebSocket from 'ws';

const ws = new WebSocket('ws://127.0.0.1:18789', {
    headers: { origin: 'http://127.0.0.1:18789' }
});

ws.on('open', () => {
    console.log('Connected to gateway');
    
    // 1. Handshake
    ws.send(JSON.stringify({
        type: 'req',
        id: 'handshake-1',
        method: 'connect',
        params: {
            client: {
                id: 'webchat',
                version: '1.0.0',
                platform: 'web',
                mode: 'webchat'
            },
            minProtocol: 1,
            maxProtocol: 3
        }
    }));
});

ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    console.log('Received:', msg);

    // 2. Chat Send after handshake ok
    if (msg.id === 'handshake-1' && msg.ok) {
        console.log('Handshake OK, sending chat message...');
        ws.send(JSON.stringify({
            type: 'req',
            id: 'msg-1',
            method: 'chat.send',
            params: {
                sessionKey: 'main',
                message: 'hello auth check',
                idempotencyKey: `idem-${Date.now()}`
            }
        }));
    }

    // 3. Check for auth injection
    if (msg.type === 'event' && msg.stream === 'chat') {
        console.log('Chat Event:', JSON.stringify(msg.data, null, 2));
        if (msg.data && msg.data.message && typeof msg.data.message === 'string' && msg.data.message.includes('首次对话需要进行认证')) {
            console.log('SUCCESS: Auth message received via chat event!');
            ws.close();
            process.exit(0);
        }
    }
});

ws.on('error', (err) => {
    console.error('WebSocket error:', err);
    process.exit(1);
});

// Timeout
setTimeout(() => {
    console.log('Timeout waiting for auth message');
    ws.close();
    process.exit(0);
}, 5000);
