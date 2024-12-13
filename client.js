import { WebrtcProvider } from "./y-webrtc.js";
import * as Y from "yjs";
import express from "express";
import crypto from "node:crypto";
import admin from "firebase-admin";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const app = express();
app.use(express.json());

const SIGNALING_SERVERS = [
    "wss://yjs-signaling-server-5fb6d64b3314.herokuapp.com/",
];

const clientID = process.argv[2];
const roomName = process.argv[3];

const buildLogger = (id) => (thing) => console.log(id, thing);

let firebaseApp = null;
if (admin.apps.length === 0) {
    firebaseApp = admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(
                Buffer.from(
                    process.env.FIREBASE_CREDENTIAL,
                    "base64",
                ).toString(),
            ),
        ),
    });
} else {
    firebaseApp = admin.apps[0];
}

const firestore = getFirestore(firebaseApp);

try {
    firestore.settings({ preferRest: true });
} catch (e) {
    console.log(e);
}

// @param updates {Array<number>} - used to indicate the number of updates each client has received since the start of the program
async function createClient(id = 0, roomName) {
    const docWriteResult = await firestore
        .collection("rooms")
        .doc(roomName)
        .set({ content: "initial" });

    const log = buildLogger(id);

    const ydoc = new Y.Doc();
    let provider = new WebrtcProvider(roomName, ydoc, {
        signaling: SIGNALING_SERVERS,
    });
    // set the user using awareness
    provider.awareness.setLocalStateField("user", {
        name: crypto.randomUUID(),
    });

    ydoc.on("update", (update) => {
        // const updateText = ydoc.getText("codemirror");
        // Y.applyUpdate(ydoc, update);

        const now = new Date().getTime();

        process.send({ type: "update", id, roomName, now });
        // console.log("got update")
    });

    // TODO: Need to be able to chose what client sends what
    // send updates at random indices every 2.5 seconds
    process.on("message", (message) => {
        if (message.action === "message") {
            // const details = JSON.parse(message.details);
            // const ytext = ydoc.getText("codemirror");
            const ymap = ydoc.getMap("codemirror");

            // clear the contents of the document so we're sending valid json
            // ytext.delete(0, ytext.length);
            // ytext.delete(0, 1e10); // when the computer refuses to do what you want you gotta be evil -@Josias

            // insert our new message
            // ytext.insert(0, message.details);
            const startTime = new Date().getTime();
            ymap.set("code", message.details);

            // wait until saving server acknowledges receipt of the message
            const waitInterval = setInterval(() => {
                if (ymap.get("response") === "ack") {
                    const timeElapsed = new Date().getTime() - startTime;
                    process.send({ type: "ack", timeElapsed });
                    clearInterval(waitInterval);
                }
            }, 100);
        }
    });
}

console.log("Spawning child process", clientID, roomName);
createClient(clientID, roomName);

// while (true) {}
// app.listen(portNumber, () => console.log("Client listening somewhere"))
setInterval(() => {}, 1000);
