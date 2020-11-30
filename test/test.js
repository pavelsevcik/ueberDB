'use strict';
/* global before, after, describe, it */
/* eslint new-cap: "warn" */

const fs = require('fs');
const ueberdb = require('../index');
const assert = require('assert');
const Randexp = require('randexp');
const databases = require('./lib/databases').databases;
const Clitable = require('cli-table');

const exists = fs.stat;
let db;

// Basic speed settings, can be overriden on a per database setting
const defaultNumberOfWrites = 20000;
const acceptableWrites = 3;
const acceptableReads = 0.1;
const acceptableRemove = 1;
const acceptableFindKeys = 1;
const CACHE_ON = true;
const CACHE_OFF = false;
const keys = Object.keys(databases);

const table = new Clitable({
  head: ['Database',
    '# of items',
    'Write(in seconds)',
    'Read(scnds)',
    'findKey(scnds)',
    'remove(scnds)'],
  colWidths: [20, 10, 20, 15, 15, 15],
});

keys.forEach(async (database) => {
  const dbSettings = databases[database];
  await ueberdbAPITests(database, dbSettings, CACHE_ON);
  await ueberdbAPITests(database, dbSettings, CACHE_OFF);
});

after(() => {
  if (databases.dirty && databases.dirty.filename) {
    exists(databases.dirty.filename, (doesExist) => {
      if (doesExist) {
        fs.unlinkSync(databases.dirty.filename);
      }
    });
  }
  console.log(table.toString());
  db.close(); // close the database
  throw new Error('Exiting');
});


async function ueberdbAPITests(database, dbSettings, cacheEnabled, done) {
  let cacheStatus;
  if (cacheEnabled) {
    cacheStatus = 'cache-on';
  } else {
    cacheStatus = 'cache-off';
  }
  describe(`ueberdb:${database}:${cacheStatus}`, function () {
    this.timeout(1000000);
    const init = (done) => {
      if (dbSettings.filename) {
        exists(dbSettings.filename, (doesExist) => {
          if (doesExist) {
            fs.unlinkSync(dbSettings.filename);
          }
        });
      }
      db = new ueberdb.database(database, dbSettings);
      db.init((e) => {
        if (e) throw new Error(e);
        if (!cacheEnabled) db.cache = 0;
        done();
      });
    };

    before(init);

    describe('white space', () => {
      const input = {a: 1, b: new Randexp(/.+/).gen()};
      let key = new Randexp(/.+/).gen();

      // set
      it('Tries to get the value with an included space', () => {
        db.set(key, input);
        db.get(`${key} `, (err, output) => {
          const matches = JSON.stringify(input) !== JSON.stringify(output);
          assert.equal(matches, true);
        });
      });

      it('Gets the correct item when whitespace is in key', () => {
        // get the input object without whitespace
        db.get(key, (err, output) => {
          const matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });

      key = new Randexp(/.+/).gen();
      const keyWithSpace = `${key} `;
      // set
      // now we do the same but with whiteSpaceInKey
      it('Tries to get the value with an included space', () => {
        db.set(`${keyWithSpace} `, input);
        // get the input object with whitespace (shouldn't get it)
        db.get(`${keyWithSpace} `, (err, output) => {
          const matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    }); // end white space

    it('basic read write', () => {
      // Basic read/write operation
      const input = {a: 1, b: new Randexp(/.+/).gen()};
      const key = new Randexp(/.+/).gen();
      // set
      db.set(key, input);
      // get the object
      db.get(key, (err, output) => {
        it('Does a basic write->read operation with a random key/value', () => {
          const matches = JSON.stringify(input) === JSON.stringify(output);
          assert.equal(matches, true);
        });
      });
    }); // end basic read writes

    it('Does a basic write->read operation with a random key/value', () => {
      const input = {testLongString: new Randexp(/[a-f0-9]{50000}/).gen()};
      const key = new Randexp(/.+/).gen();
      // set long string
      db.set(key, input);

      // get the object
      db.get(key, (err, output) => {
        const matches = JSON.stringify(input) === JSON.stringify(output);
        assert.equal(matches, true);
      });
    });

    // Basic findKeys test functionality
    it('Does a basic findKeys operation with a random key/value', () => {
      const input = {a: 1, b: new Randexp(/.+/).gen()};
      // TODO setting a key with non ascii chars
      const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
      // set two nested keys under the key
      db.set(`${key}:test2`, input);
      db.set(`${key}:test`, input);
      // get the keys of each value
      db.findKeys(`${key}:*`, null, (err, output) => {
        for (const keyVal in output) {
          if (output[keyVal]) {
            // get each value
            db.get(output[keyVal], (e, output) => {
              const matches = JSON.stringify(input) === JSON.stringify(output);
              assert.equal(matches, true);
            });
          }
        }
      });
    });

    it('Tests a key has been deleted', () => {
      const input = {a: 1, b: new Randexp(/.+/).gen()};
      const key = new Randexp(/.+/).gen();
      db.set(key, input);

      db.get(key, (e, output) => {
        const matches = JSON.stringify(input) === JSON.stringify(output);
        assert.equal(matches, true);
      });
      db.remove(key);

      db.get(key, (e, output) => {
        const matches = (typeof output === 'undefined' || output == null);
        assert.equal(matches, true);
      });
    });

    // Read/write operations with timers to catch events
    it('Speed is acceptable', () => {
      this.timeout(1000000);
      const input = {a: 1, b: new Randexp(/.+/).gen()};
      // TODO setting a key with non ascii chars
      const key = new Randexp(/([a-z]\w{0,20})foo\1/).gen();
      const timers = {};
      timers.start = Date.now();
      const numberOfWrites = (dbSettings.speeds && dbSettings.speeds.numberOfWrites) ||
      defaultNumberOfWrites;
      for (let i = 0; i < numberOfWrites; i++) {
        db.set(key + i, input);
      }

      timers.written = Date.now();

      for (let i = 0; i < numberOfWrites; i++) {
        db.get(key + i, (err, output) => {
          if (err) throw new Error('Error .get');
        });
      }
      timers.read = Date.now();

      // do a findKeys Event

      for (let i = 0; i < numberOfWrites; i++) {
        db.findKeys(key + i, null, (err, output) => {
          if (err) throw new Error('Error .findKeys');
        });
      }
      timers.findKeys = Date.now();

      for (let i = 0; i < numberOfWrites; i++) {
        db.remove(key + i, null, (err, output) => {
          if (err) throw new Error('Error .remove');
        });
      }
      timers.remove = Date.now();
      const timeToWrite = timers.written - timers.start;
      const timeToRead = timers.read - timers.written;
      const timeToFindKey = timers.findKeys - timers.read;
      const timeToRemove = timers.remove - timers.findKeys;
      const timeToWritePerRecord = timeToWrite / numberOfWrites;
      const timeToReadPerRecord = timeToRead / numberOfWrites;
      const timeToFindKeyPerRecord = timeToFindKey / numberOfWrites;
      const timeToRemovePerRecord = timeToRemove / numberOfWrites;
      table.push([`${database}:${cacheStatus}`,
        numberOfWrites,
        timeToWritePerRecord,
        timeToReadPerRecord,
        timeToFindKeyPerRecord,
        timeToRemovePerRecord]);

      const acceptableReadTime = (((dbSettings.speeds && dbSettings.speeds.read) ||
       acceptableReads));
      console.log('ART', acceptableReadTime, timeToReadPerRecord);
      const reads = acceptableReadTime >= timeToReadPerRecord;

      const acceptableWriteTime = (((dbSettings.speeds && dbSettings.speeds.write) ||
       acceptableWrites));
      console.log('AWT', acceptableWriteTime, timeToWritePerRecord);
      const writes = acceptableWriteTime >= timeToWritePerRecord;

      const acceptableFindKeysTime = (((dbSettings.speeds && dbSettings.speeds.findKey) ||
       acceptableFindKeys));
      console.log('AFKT', acceptableFindKeysTime, timeToFindKeyPerRecord);
      const findKeys = acceptableFindKeysTime >= timeToFindKeyPerRecord;

      const acceptableRemoveTime = (((dbSettings.speeds && dbSettings.speeds.remove) ||
       acceptableRemove));
      console.log('ARemT', acceptableRemoveTime, timeToRemovePerRecord);
      const remove = acceptableRemoveTime >= timeToRemovePerRecord;
      assert.equal((reads === writes === findKeys === remove), true);
    });
  });
  //  done
}


// TODO: Need test which prefills with 1e7 of data then does a get.
