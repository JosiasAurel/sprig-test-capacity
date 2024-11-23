import readline from 'node:readline';
import crypto from "node:crypto";

const CONTROLLER_URL = "http://127.0.0.1:3001";

async function sendCommand(path) {
    console.log("Path", path);
    const response = await fetch(`${CONTROLLER_URL}/${path}`);
    // const data = await response.text();
    const data = await response.json();

    return data;
}

async function handleCommand(command) {
    let path;
    if (command.startsWith("cr ")) { // command to create a new room with some clients
        path = 'create-room/' + command.slice(3).split(" ").join("/");
    } else if (command.startsWith("ac ")) { // command to add clients in a room
        path = 'create-room/' + command.slice(3).split(" ").join("/");
    } else if (command.startsWith("dr ")) { // command to delete a room
        path = 'delete-room/' + command.slice(3).split(" ").join("/");
    } else if (command.startsWith("dc ")) { // command to delete clients in a room
        path = 'delete-client/' + command.slice(3).split(" ").join("/");
    } else if (command.startsWith("su ")) { // command to delete clients in a room
        path = 'send-update/' + command.slice(3).split(" ").join("/");
    } else if (command.startsWith("bc ")) {
        const [ clientCount, updatePerCount ] = command.slice(3).split(" ");
        const roomName = crypto.randomUUID();
        // for (let i = 0; i < clientCount; i++) {
        //     path = 'create-room/' + roomName + "/" + '1';
        //     for (let j = 0; j < updatePerCount; j++) {
        //         path = 'send-update/' + roomName + "/" + ;
        //         const result = await sendCommand();
        //     }
        // }
    }
    const result = await sendCommand(path);

    if (result.ok) return console.log('✅');
    return console.warn(`Error: ${result.msg}`);
}

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
});

while (true) {
    await new Promise((resolve, reject) => {
        rl.question(`> `, async command => {
            await handleCommand(command);
            resolve();
            // rl.close();
        });
    });
}
