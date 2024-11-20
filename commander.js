import readline from 'node:readline';


const CONTROLLER_URL = "http://127.0.0.1:3001";

async function createRoom(roomName) {
    const response = await fetch(`${CONTROLLER_URL}/create-room/${roomName}`);
    if (response.ok) return true;
    return false;
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

while (true) {
    await new Promise((resolve, reject) => {
        rl.question(`What should be the room name? `, async name => {
            await createRoom(name);
            resolve();
            // rl.close();
        });
    });
}
