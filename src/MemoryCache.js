import LRU from 'lru-cache'; // https://github.com/isaacs/node-lru-cache

export default class MemoryCache {

    constructor() {
        this.cache = LRU({
            max: (window.screen.width < 1080 ? 10 : 30) * 1024 * 1024, 
            maxAge: 1000*60*5,
            length: obj => sizeof(obj),
        });
    }

    get(key) {
        return this.cache.get(key);
    }

    set(key, value) {
        this.cache.set(key,value);
    }

    delete(key) {
        this.cache.del(key);
    }

    clear() {
        this.cache.reset();
    }
}

const ARRAY_ESTIMATE = 10;
const OBJECT_ESTIMATE = 50;

// https://stackoverflow.com/questions/1248302/how-to-get-the-size-of-a-javascript-object
function sizeof(obj) {
    let stack = [obj];
    let bytes = 0;

    while(stack.length) {
        let value = stack.pop();

        bytes += 2; // variable type
        if(value == null || typeof value === 'boolean') {
            bytes += 4;
        } else if(typeof value === 'string') {
            bytes += 8 + value.length * 2;
        } else if(typeof value === 'object') {
            if(Array.isArray(value)) {
                bytes += 8; // length
                if(value.length <= ARRAY_ESTIMATE) {
                    for(let x of value) {
                        stack.push(x);
                    }
                } else {
                    // average out the size so that we don't have to do a deep count
                    let arrSize = 0;
                    for(let i = 0; i < ARRAY_ESTIMATE; ++i) {
                        arrSize += sizeof(value[i]);
                    }
                    bytes += arrSize / ARRAY_ESTIMATE * value.length;
                }
            } else {
                bytes += 12; // meta-data
                let keys = Object.keys(value);
                if(keys.length <= OBJECT_ESTIMATE) {
                    for(let key of keys) {
                        stack.push(key);
                        stack.push(value[key]);
                    }
                } else {
                    let objSize = 0;
                    for(let i = 0; i < OBJECT_ESTIMATE; ++i) {
                        objSize += sizeof(keys[i]) + sizeof(value[keys[i]]);
                    }
                    bytes += objSize / OBJECT_ESTIMATE * keys.length;
                }
            }
        } else {
            bytes += 8;
        }
    }
    return bytes;
}

/*
should have the following interface:

- set
- get
- delete
- clear

similar to "Map", but not quite the same as storage (https://developer.mozilla.org/en-US/docs/Web/API/Storage).


should we use a MinHeap for LRU or.... what? "set associative cache"
MinHeap would allow us to look up the 'oldest' item in O(1) but what about key lookup?
see also https://github.com/epoberezkin/sacjs
 */