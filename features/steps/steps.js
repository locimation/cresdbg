const { Given, Then, AfterAll } = require('@cucumber/cucumber');
const crestron = require('../../lib/crestron');

// Login options
Given('a control processor at {string}', async (host) => {
    await crestron.setHost(host);
});

Given('a username of {string}', async (username) => {
    await crestron.setUsername(username);
});

Given('a password of {string}', async (password) => {
    await crestron.setPassword(password);
});

// Signal steps

async function setSignal(signalName, value) {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await crestron.setSignal(signalName, value);
}

async function pulseSignalHigh(signalName, duration) {
  await setSignal(signalName, `p${duration}`);
}

async function pulseSignalLow(signalName, duration) {
  await setSignal(signalName, `i${duration}`);
}

Given('{string} set to {string}', setSignal);
Given('{string} set to {int}', setSignal);

Given('{string} set to 1 for {int} ms', pulseSignalHigh);
Given('{string} set to 0 for {int} ms', pulseSignalLow);

AfterAll(async () => {
    await crestron.disconnect();
});

async function checkSignal(signalName, expectedValue) {

    await new Promise((resolve) => setTimeout(resolve, 50));

    const actualValue = await crestron.getSignal(signalName);

    const maybeNum = Number.parseInt(expectedValue, 10);
    if (!Number.isNaN(expectedValue) && actualValue === maybeNum) {
      return; // OK
    }
  
    if (actualValue !== expectedValue) {
      throw new Error(`Expected ${signalName} to be ${expectedValue}, but got ${actualValue}`);
    }

}

Then('{string} should be {int}', checkSignal);
Then('{string} should be {string}', checkSignal);
  