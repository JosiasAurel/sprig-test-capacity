import express from "express";
import * as Y from "yjs";
import admin from "firebase-admin";
import { WebrtcProvider } from "./y-webrtc.js";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { config } from "dotenv";
import { StatsD } from "node-statsd";
import { configDotenv } from "dotenv";
import crypto from "node:crypto";
import { spawn, fork } from "node:child_process";
import { stringify } from "csv";
import { writeFileSync } from "node:fs";
config();

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
const CHILD_PROCESS_MAX_LISTENERS = 100;
const app = express();
app.use(express.json());

let portNumber = 4000;

let updates = {};

function spawnChild(parentRoom, idx) {
    const controller = new AbortController();
    const { signal } = controller;

    const childClient = fork("./client.js", [idx, parentRoom], { signal });
    const pid = childClient.pid;

    childClient.setMaxListeners(CHILD_PROCESS_MAX_LISTENERS);

    updates[parentRoom] = {
        ...updates[parentRoom],
        [pid]: {
            lastTime: 0,
            delay: 0,
            count: 0,
            child: childClient,
            controller: controller,
            pid: pid,
            dead: false,
        },
    };

    console.log("spawned child", childClient.pid, parentRoom);

    // listen and handle messages from the child process
    childClient.on("message", (message) => {
        console.log(childClient.pid, "Sending update to index", idx);
        if (message.type !== "update") return;

        updates[parentRoom][pid] = {
            ...updates[parentRoom][pid],
            lastTime: message.now,
            delay:
                updates[parentRoom][pid].lastTime === 0
                    ? 0
                    : message.now - updates[parentRoom][pid].lastTime,
            count: updates[parentRoom][pid].count + 1,
        };
    });

    childClient.on("error", (_) => {
        updates[parentRoom][pid] = { ...updates[parentRoom][pid], dead: true };
        controller.abort();
    });

    // kill the child client if the process receives a termination signal
    process.on("SIGINT", () => {
        controller.abort();
    });

    return { controller, childClient };
}

function buildRoomWithClients(roomName = "oDWL6LS54Dt1rpFdftyW", NUM_CLIENTS) {
    const clients = new Array(NUM_CLIENTS).fill(0).map(function (_, idx) {
        return spawnChild(roomName, idx);
    });

    return { id: roomName, clients };
}

function main() {
    const NUM_CLIENTS = 2;
    const NUM_ROOMS = 2;

    new Array(NUM_ROOMS)
        .fill(0)
        .map(() => {
            let roomId = crypto.randomUUID();
            return roomId;
        })
        .map((room, idx) => {
            // build room with clients
            return buildRoomWithClients(room, NUM_CLIENTS);
        });

    // setInterval(() => {
    //   console.clear();
    //   Object.keys(updates).forEach((roomKey, roomIdx) => {
    //     const childClients = updates[roomKey];
    //     let childClientValues = Object.values(childClients);
    //     childClientValues = childClientValues.map(childClientValue => Object.fromEntries(Object.entries(childClientValue).filter(entry => !entry.includes('controller'))))
    //     const averageDelay = childClientValues.reduce((totalDelay, currentClient) => totalDelay + currentClient.delay, 0) / childClientValues.length;
    //     console.group(`Room ${roomIdx} / ID: ${roomKey}`);
    //     console.log("Average Delay: ", averageDelay);
    //     console.table(childClientValues)
    //     // console.table(childClients);
    //     console.groupEnd();
    //   });

    // }, 1000);
}

main();

app.get("/", (req, res) => {
    res.send("Working...");
});

async function createRoom(roomName, clientCount, firebase = false) {
    console.log("About to create a room");
    // create the room if it doesn't exist yet
    if (!Object.hasOwn(updates, roomName)) {
        updates = { ...updates, [roomName]: {} };

        // tell the saving server to start listening to this room
        if (firebase) {
            // create the document in firebase if it doesn't exist yet
            const firestoreRoom = await firestore
                .collection("rooms")
                .doc(roomName);

            // if the firestore document doesn't exist, set a new value for it
            if (!(await firestoreRoom.get()).exists) {
                console.log("creating room in firebase");
                await firestoreRoom.set({ content: "initial" });
            }

            // tell the saving server to begin listening to the room
            console.log("about to send request to saving server");
            const response = await fetch(
                `http://localhost:3002/add-room/${roomName}`,
            );
            const _ = await response.json();
        }
    }

    // add `clientCount` clients to the room
    for (let i = 0; i < clientCount; i++) {
        spawnChild(roomName, Object.keys(updates[roomName]).length);
    }
}

function resetRoomAndClients() {
    Object.values(updates).forEach((roomClients) => {
        Object.values(roomClients).forEach((client) =>
            client.controller.abort(),
        );
    });

    // flush the updates array
    updates = {};
}

// this can be used for both spinning up a room with clients or adding new clients to an existing room
app.get("/create-room/:roomName/:clients", async (req, res) => {
    const roomName = req.params.roomName;
    const clientCount = parseInt(req.params.clients ?? "0");

    await createRoom(roomName, clientCount);
    res.status(200).json({ ok: true });
});

app.get("/delete-room/:roomName", (req, res) => {
    const roomName = req.params.roomName;

    if (!Object.hasOwn(updates, roomName))
        res.json({ ok: false, msg: "Room does not exist" });

    // kill all the clients in that room
    Object.values(updates[roomName]).forEach((client) =>
        client.controller.abort(),
    );

    delete updates[roomName];

    res.json({ ok: true });
});

app.get("/delete-client/:roomName/:clients", (req, res) => {
    const roomName = req.params.roomName;
    const clientCount = parseInt(req.params.clients ?? "0");

    for (let i = 0; i < clientCount; i++) {
        const clients = Object.keys(updates[roomName]);
        let randomClientIndex = Math.floor(Math.random() * clients.length);

        const randomClient = clients[randomClientIndex];
        randomClient.controller.abort();
    }

    res.json({ ok: true });
});

app.get("/send-update/:roomName/:clientId", (req, res) => {
    const roomName = req.params.roomName;
    const clientId = req.params.clientId ?? "0";

    if (!Object.hasOwn(updates, roomName))
        res.json({ ok: false, msg: "Room does not exist" });
    if (!Object.hasOwn(updates[roomName], clientId))
        res.json({ ok: false, msg: "Client does not exit" });

    const client = updates[roomName][clientId];
    // tell the child process to send an update
    client.child.send({ action: "message" });

    res.json({ ok: true });
});

const computeAverageLatency = (roomName) => {
    const childClients = Object.values(updates[roomName]);
    return (
        childClients.reduce(
            (totalLatency, currentClient) => totalLatency + currentClient.delay,
            0,
        ) / childClients.length
    );
};

const stats = [];
app.get("/self-test-room/:clientCount/:updateCount", async (req, res) => {
    resetRoomAndClients();

    const clientCount = parseInt(req.params.clientCount ?? "10");
    const updateCount = parseInt(req.params.updateCount ?? "10");

    const roomName = crypto.randomUUID();

    // create a new room with two clients
    await createRoom(roomName, 2);

    const latencyList = [];
    for (let i = 0; i < clientCount - 2; i++) {
        // create a new client
        const { childClient } = spawnChild(roomName, i + 2);
        let latencies = [];

        for (let j = 0; j < updateCount; j++) {
            childClient.send({ action: "message" });
            // wait until message has been sent
            await new Promise((resolve, reject) => {
                childClient.on("message", (message) => {
                    if (message.type === "ack") resolve();
                });
            });
            latencies.push(computeAverageLatency(roomName));
        }

        // record the average latency
        latencyList.push({
            clientCount: Object.values(updates[roomName]).length,
            delay:
                latencies.reduce((acc, curr) => acc + curr, 0) /
                latencies.length,
        });

        // reset the array for the next calculation
        latencies = [];
    }

    stringify(
        latencyList,
        {
            header: true,
            columns: {
                clientCount: "clientCount",
                delay: "delay",
            },
        },
        (err, out) => {
            if (err) res.json({ ok: false, msg: "Failed to create csv" });

            // write the output to a file
            writeFileSync("single-room.csv", out);
        },
    );

    res.json({ ok: true });
});

const randomIndex = (length) => Math.floor(Math.random() * length);

// *Measure the latency -- Average latency across every room
// Sum(Average latency across all clients in a room) [0 - N] / N

// Create two rooms
// Send updates from one client in each room
// Measure and record the latency of the update
//  Add a new clients to each room
//  Measure the latency when sending updates across the clients in each room
//  Add a new room with the same number of clients as every other room
// Measure the latency across all the rooms again and record
// *Keeps going till we've reached the target number of rooms and clients per room

app.get(
    "/self-test-multiroom/:roomCount/:clientCount/:updateCount",
    async (req, res) => {
        resetRoomAndClients();

        const roomCount = parseInt(req.params.roomCount ?? "10");
        const clientCount = parseInt(req.params.clientCount ?? "10");
        const updateCount = parseInt(req.params.updateCount ?? "5");

        const [room1, room2] = new Array(2)
            .fill(0)
            .map((_) => crypto.randomUUID());
        await createRoom(room1, 2, true);
        await createRoom(room2, 2, true);

        let currentRoomCount = 2;
        let currentClientCount = 2;
        let latencies = [];
        const ackQueue = [];

        // const averageLatency = await loadTestClients();
        latencies.push({
            ...(await loadTestClients()),
            roomCount: currentRoomCount,
            clientCount: currentClientCount,
        });
        writeDataToCsv(latencies);
        
        // log stats every second
        setInterval(() => {
            console.clear();
            console.log("Current Room Count: ", currentRoomCount);
            console.log("Current Client Count: ", currentClientCount);
            console.log("Ack Queue Length: ", ackQueue.length);
        }, 1000);

        // while we haven't reached the target number of rooms and clients per room
        // keep adding more rooms and computing the latency
        while (
            currentRoomCount != roomCount &&
            currentClientCount != clientCount
        ) {
            // to give firebase some slack
            setTimeout(() => {}, 1000);
            // increase if it hasn't reached the desired count
            currentClientCount += currentClientCount < clientCount ? 1 : 0;

            // increase the number of clients in every room
            const roomKeys = Object.keys(updates);
            roomKeys.forEach((roomKey) =>
                increaseClientCountsTo(roomKey, currentClientCount),
            );

            latencies.push({
                ...(await loadTestClients()),
                roomCount: currentRoomCount,
                clientCount: currentClientCount,
            });
            writeDataToCsv(latencies);

            await createRoom(crypto.randomUUID(), currentClientCount, true);
            // increase if it hasn't reached the desired count
            currentRoomCount += currentRoomCount < roomCount ? 1 : 0;

            latencies.push({
                ...(await loadTestClients()),
                roomCount: currentRoomCount,
                clientCount: currentClientCount,
            });
            writeDataToCsv(latencies);
        }

        async function increaseClientCountsTo(roomName, count) {
            const newClientsCount =
                count - Object.keys(updates[roomName]).length;
            await createRoom(roomName, newClientsCount);
        }

        async function loadTestClients() {
            const latencies = [];
            const delays = [];
            const roomKeys = Object.keys(updates);

            for (let roomKey of roomKeys) {
                const clients = updates[roomKey];
                const clientValues = Object.values(clients);

                const randomClient =
                    clientValues[randomIndex(clientValues.length)];

                const updatesLatency = [];
                const updateDelays = [];
                for (let i = 0; i < updateCount; i++) {
                    randomClient.child.send({
                        action: "message",
                        details: JSON.stringify({
                            clientCount: currentClientCount,
                            roomCount: currentRoomCount,
                        }),
                    });
                    ackQueue.push(1);

                    // wait until we get acknowledgement from client that message was received
                    await new Promise((resolve, reject) => {
                        randomClient.child.on("message", (message) => {
                            if (message.type === "ack") {
                                ackQueue.pop();
                                updateDelays.push(message.timeElapsed);
                                resolve();
                            }
                        });
                    });

                    updatesLatency.push(computeAverageLatency(roomKey));
                }
                // push average latency across <updateCount> updates
                let updatesAverageLatency =
                    updatesLatency.reduce((acc, curr) => acc + curr, 0) /
                    updatesLatency.length;
                let averageDelay =
                    updateDelays.reduce((acc, curr) => acc + curr, 0) /
                    updateDelays.length;
                if (updatesLatency.length > 0) {
                    latencies.push(updatesAverageLatency);
                }
                if (updateDelays.length) {
                    delays.push(averageDelay);
                }

                // latencies.push(
                //     // only add to list if length is > 0
                //     // dividing by 0 will give NaN and pollute the future values
                //     updatesLatency.length > 0 ? updatesAverageLatency : 0,
                // );
                // delays.push(updateDelays.length > 0 ? averageDelay : 0):
            }

            // compute average latency across every room
            const averageLatency =
                latencies.reduce((acc, curr) => acc + curr, 0) /
                latencies.length;
            const averageDelay =
                delays.reduce((acc, curr) => acc + curr, 0) / delays.length;
            return {
                latency: latencies.length > 0 ? averageLatency : 0,
                delay: delays.length > 0 ? averageDelay : 0,
            };
        }

        writeDataToCsv();

        // tell the saving server we're done on our side
        await fetch("http://localhost:3002/done");
        res.json({ ok: true });
    },
);

function writeDataToCsv(latencies) {
    stringify(
        latencies,
        {
            header: true,
            columns: {
                clientCount: "clientCount",
                latency: "latency",
                roomCount: "roomCount",
                delay: "delay",
            },
        },
        (err, out) => {
            if (err) res.json({ ok: false, msg: "Failed to create csv" });

            // write the output to a file
            writeFileSync("multi-room.csv", out);
        },
    );
}

process.on("SIGINT", () => {
    // kill all processes across all rooms
    Object.values(updates).map((roomChildren) => {
        Object.values(roomChildren).map((child) => child.controller.abort());
    });
    process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("Listening on port", PORT));
