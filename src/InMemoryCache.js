import LRU from 'lru-cache'; // https://github.com/isaacs/node-lru-cache

export default class InMemoryCache {

    constructor() {
        this.cache = LRU({
            max: 30*1024*1024, 
            maxAge: 1000*60*5,
            length: obj => roughSize(obj),
        });
    }

    get() {

    }

    set() {

    }

    delete() {

    }

    clear() {

    }
}


// https://stackoverflow.com/questions/1248302/how-to-get-the-size-of-a-javascript-object
function roughSize(obj) {

    let seen = new Set();
    let stack = [obj];
    let bytes = 0;

    while(stack.length) {
        let value = stack.pop();

        bytes += 2; // variable type
        if(typeof value === 'boolean') {
            bytes += 4;
        } else if(typeof value === 'string') {
            bytes += 8 + value.length * 2;
        } else if(typeof value === 'object') {
            if(seen.has(value)) {
                bytes += 8; // size of pointer
            } else {
                seen.add(value);
                if(Array.isArray(value)) {
                    bytes += 8; // length
                    for(let x of value) {
                        stack.push(x);
                    }
                } else {
                    bytes += 12; // meta-data
                    for(let key of Object.keys(value)) {
                        stack.push(key);
                        stack.push(value[key]);
                    }
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