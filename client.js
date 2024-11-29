import { WebrtcProvider } from "./y-webrtc.js";
import * as Y from "yjs";
import express from "express";
import crypto from "node:crypto";
import admin from "firebase-admin";
import { Timestamp, getFirestore } from "firebase-admin/firestore";

const app = express();
app.use(express.json());

const SIGNALING_SERVERS = ["wss://yjs-signaling-server-5fb6d64b3314.herokuapp.com/"]

const clientID = process.argv[2];
const roomName = process.argv[3];

const buildLogger = id => thing => console.log(id, thing);

let firebaseApp = null;
if (admin.apps.length === 0) {
  firebaseApp = admin.initializeApp({
    credential: admin.credential.cert(
      JSON.parse(
        Buffer.from(process.env.FIREBASE_CREDENTIAL, "base64").toString()
      )
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
    const docWriteResult = await firestore.collection("rooms").doc(roomName).set({ content: "initial" });

    const log = buildLogger(id);

    const ydoc = new Y.Doc();
    let provider = new WebrtcProvider(roomName, ydoc, { signaling: SIGNALING_SERVERS });
    // set the user using awareness  
    provider.awareness.setLocalStateField("user", {
        name: crypto.randomUUID()
    });

    ydoc.on("update", update => {
        const updateText = ydoc.getText("codemirror");
        Y.applyUpdate(ydoc, update);

        const now = new Date().getTime();

        process.send({ type: 'update', id, roomName, now });
        // console.log("got update")
    });

    // TODO: Need to be able to chose what client sends what
    // send updates at random indices every 2.5 seconds
    process.on("message", message => {
        if (message.action === "message") {
            // const details = JSON.parse(message.details);
            ydoc.getText("codemirror").insert(0, message.details);
            process.send({ type: 'ack' });
        }
    });

    // if (Math.random() > 0.5) {
    //     const timeoutHandle = setTimeout(() => {
    //         ydoc.getText("codemirror").insert(Math.floor(Math.random(), 10), "this change came from the headless client");
    //         clearTimeout(timeoutHandle);
    //     }, Math.floor(Math.random() * 3000));
    // }

    // setInterval(() => {
    //     ydoc.getText("codemirror").insert(Math.floor(Math.random(), 10), "this change came from the headless client");
    // }, 2500);

}

console.log("Spawning child process", clientID, roomName);
createClient(clientID, roomName);

// while (true) {}
// app.listen(portNumber, () => console.log("Client listening somewhere"))
setInterval(() => {}, 1000);
