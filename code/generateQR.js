//////////////////////////////////////////////////////////
// Attendee generate QR-app
// (c) A.J. Wischmann 2021
//////////////////////////////////////////////////////////
"use strict";

const { bufferToHex, sha256, utf8ToBuffer } = require("eccrypto-js");
const luxon = require("luxon");
const fs = require("fs");
const prompt = require("prompt-sync")({ sigint: true });
const colors = require("colors");
const { parse } = require("path");

async function readInfoFromWallet() {
  // Try and load the wallet personalinfo from json file
  let parsedData;
  try {
    const personalInformation = fs.readFileSync("./json/personalWallet.json");
    if (personalInformation) {
      parsedData = JSON.parse(personalInformation.toString());
    }
  } catch (e) {
    console.log(`Error : ${e}`);
  }
  console.log(`Name : ${parsedData.firstname} ${parsedData.lastname}`.green);
  return parsedData;
}

async function readEventWallet() {
  let parsedData;
  try {
    const eventInfo = fs.readFileSync("./json/eventWallet.json");
    if (eventInfo) {
      parsedData = JSON.parse(eventInfo.toString());
    }
  } catch (e) {
    console.log(`Error : ${e}`);
  }
  return parsedData;
}

async function saveVerifierQR(verifierdata) {
  // Store QR-code for verifier so we can use it in verifier.js
  console.log("Save VerifierQR >>>>>>>>".green);
  try {
    fs.writeFileSync("./json/verifierQR.json", verifierdata);
  } catch (e) {
    console.error(e);
  }
}

async function hashHash(mroot) {
  let element = await sha256(utf8ToBuffer(mroot));
  return bufferToHex(element);
}

function engarble(txt) {
  // encrypt and shift verifierQR
  let base = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let dict = "5TXY6VWD8BEF7CUHI2RSZ34LM9ANOGJK01PQ";
  let cipherValue = Math.floor(Math.random() * 36);
  let key = dict[cipherValue];
  let z = "";

  for (let i = 0; i < txt.length; i++) {
    z += dict[(base.indexOf(txt[i]) + cipherValue) % 36];
  }
  let shifted = cipherValue % 31;
  let arretje = z.split("");
  for (let s = 0; s < shifted; s++) {
    let l = arretje.shift();
    arretje.push(l);
  }
  z = arretje.join("") + key;
  return z;
}

// readWalletInformation
// generateQR
// writeQR

async function run() {
  // generate a new verifierQRcode for a past event from personalWallet

  console.log(`VerifierQRcode-generator`.cyan);
  let includePersonalData = false;
  let menuChoice = prompt(
    `Would you like to incorporate your Name and Birthdate? [y,N] : `.yellow
  );
  if (menuChoice.toUpperCase() === "Y") includePersonalData = true;

  let qrTypeIPFS = false;
  menuChoice = prompt(
    `IPFS QR code? [y,N] :`.yellow
  );
  if (menuChoice.toUpperCase() === "Y") qrTypeIPFS = true;

  console.log(`Generating....`);
  const personalInformation = await readInfoFromWallet();
  const eventInformation = await readEventWallet();
  console.log(`mr : ${personalInformation.mr}`);
  console.log(`er : ${eventInformation.er}`);

  let eventPersonalMerkleRoot = personalInformation.mr + eventInformation.er;
  const merkleHash = await hashHash(eventPersonalMerkleRoot);
  const nowEpoch = luxon.DateTime.now().toMillis();
  let stringWord = nowEpoch;
  let verifierQR;



  if (qrTypeIPFS) {

    verifierQR = bufferToHex(merkleHash);
    verifierQR = verifierQR.toUpperCase();
    verifierQR = engarble(verifierQR);
    
    verifierQR += eventInformation.publicCID + eventInformation.attendeeCID + eventInformation.storageKey + stringWord;

  } else {
    verifierQR = bufferToHex(merkleHash) + eventInformation.er + stringWord;
  }



  let personalString = "";
  if (includePersonalData)
    personalString = `${personalInformation.firstname} ${personalInformation.lastname}, ${personalInformation.birthdate}//`;
  const crcCheck = await hashHash(verifierQR + personalString + "SSAsaltQ3v%");
  verifierQR += crcCheck.slice(-5);

  if (!qrTypeIPFS) {
    verifierQR = verifierQR.toUpperCase();
    verifierQR = engarble(verifierQR);
  }

  if (includePersonalData) verifierQR = personalString + verifierQR;
  console.log(`VerifierQR : ${verifierQR}`.green);
  saveVerifierQR(verifierQR);
  console.log(`You can use this QR-code to show to your verifier :`);
  console.log(
    `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${verifierQR}`
      .yellow
  );

}

run();
