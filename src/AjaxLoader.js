import React from 'react';
import shallowEqual from 'shallowequal';
import objectHash from 'object-hash'; // also a good choice: json-stable-stringify
import * as FP from './FetchPolicy';

export default class AjaxLoader {

    constructor({
        endpoint,
        cache,
        hash = objectHash,
        batchSize = 4, 
        minDelay = 8, 
        maxDelay = 32, 
        fetchOptions,
        refreshAllProp,
        
        defaultDataProp = 'ajaxData',
        defaultLoadingProp = 'ajaxLoading',
        defaultErrorProp = 'ajaxError',
        defaultEqualityCheck = shallowEqual,
        defaultHandler = setStateHandler,
        defaultFetchPolicy = FP.CacheAndNetwork,
      
    }) {
        this.options = {
            endpoint,
            cache,
            hash,
            batchSize,
            minDelay,
            maxDelay,
            fetchOptions,
            refreshAllProp,
            defaultDataProp,
            defaultLoadingProp,
            defaultErrorProp,
            defaultEqualityCheck,
            defaultHandler,
            defaultFetchPolicy,
        };
        
        this.batch = new Map;
        this.start = null;
        this.timer = null;
        this.reqId = 0;
        this.rankCounter = 0;
        this.rankLookup = Object.create(null);

        if(this.options.batchSize <= 0) {
            throw new Error(`batchSize must be > 0, got ${this.options.batchSize}`);
        }
    }

    hoc(...requests) {
        const loader = this;
        
        for(let req of requests) {
            setDefaults(req, {
                equalityCheck: this.options.defaultEqualityCheck,
                handler: this.options.defaultHandler,
                loadingProp: this.options.defaultLoadingProp,
                errorProp: this.options.defaultErrorProp,
                dataProp: this.options.defaultDataProp,
                refreshProp: null,
                fetchPolicy: this.options.defaultFetchPolicy,
            });
        }

        return function ajaxLoaderEnhancer(BaseComponent) {

            class AjaxEnhanced extends React.Component {
                static displayName = `ajaxLoader(${BaseComponent.displayName || BaseComponent.name || 'Component'})`;
                
                constructor(props) {
                    super(props);
                    // *copy* all the requests into the component
                    this.requests = requests.map(req => ({
                        ...req,
                        _component: this,
                        _id: ++loader.reqId,
                    })); 
                    this.lastData = Object.create(null);
                }
                
                componentWillMount() {
                    loader._push(this.requests.map(req => {
                        if(typeof req.data === 'function') {
                            let data = req.data.call(this, this.props);
                            this.lastData[req._id] = data;
                            req = {...req, data};
                        }

                        return req;
                    }));
                }

                componentWillReceiveProps(nextProps) {
                    let updated = this.requests.reduce((acc, req) => {
                        if(typeof req.data === 'function') {
                            let data = req.data.call(this, nextProps);
                            if(!req.equalityCheck(this.lastData[req._id], data)) {
                                this.lastData[req._id] = data;
                                acc.push({...req, data});
                            }
                        }
                        return acc;
                    }, []);

                    if(updated.length) {
                        loader._push(updated);
                    }
                }

                render() {
                    let props = {...this.props, ...this.state};
                    let refreshFuncs = [];
                    for(let req of this.requests) {
                        const refresh = () => {
                            req = {...req, noCache: true};
                            if(typeof req.data === 'function') {
                                req.data = this.lastData[req._id] = req.data.call(this, this.props);
                            }
                            loader._push([req]);
                        };
                        
                        if(req.refreshProp) {
                            props[req.refreshProp] = refresh;
                        }

                        refreshFuncs.push(refresh);
                    }
                    if(loader.options.refreshAllProp) {
                        props[loader.options.refreshAllProp] = () => {
                            for(let fn of refreshFuncs) {
                                fn();
                            }
                        };
                    }
                    return React.createElement(BaseComponent, props);
                }
            }

            return AjaxEnhanced;
        };
    }

    _push = requests => {
        for(let req of requests) {
            let cacheHit = false;
            let key = this.options.hash([req.route,req.data]);
            
            if(this.options.cache && req.fetchPolicy !== FP.NetworkOnly && !req.noCache) {
                let res = this.options.cache.get(key);
                if(res !== undefined) {
                    success(req, res);
                    if(req.fetchPolicy !== FP.CacheAndNetwork) {
                        continue;
                    }
                    cacheHit = true;
                }
            }
            
            // console.log(JSON.stringify(map2obj(this.batch),null,2));
            // this.batch.forEach((breqs,bkey) => {
            //
            //    
            //     let oldRequests = breqs.filter(r => r._id === req._id);
            //    
            //     if(oldRequests.length) {
            //         for(let or of oldRequests) {
            //             if(or.loadingProp) {
            //                 or._component.setState(state => ({
            //                     [or.loadingProp]: state[or.loadingProp] - 1,
            //                 }));
            //             }
            //         }
            //         // filterInPlace(breqs, r => r._id !== req._id);
            //     }
            //    
            //     // let removed = 
            //     // if(removed && req.loadingProp) {
            //     //     console.log('cancelled',removed);
            //     //     req._component.setState(state => ({
            //     //         [req.loadingProp]: state[req.loadingProp] - removed,
            //     //     }));
            //     // }
            // });
            
            let entry = this.batch.get(key);
            if(entry) {
                entry.push(req);
            } else {
                this.batch.set(key, [req]);
            }

            if(req.loadingProp) { // FIXME: !cacheHit will cause loading to go into the negatives, no? -- no, but this still isn't right
                // FIXME: if there's a cache hit but fetch policy is cache-and-network, then....should we show the loading or not? 
                // FIXME: why are the results flashing when there was a cache hit..? -- I think this is because the results for the last page are coming in
                req._component.setState(state => ({
                    [req.loadingProp]: state[req.loadingProp] ? state[req.loadingProp] + 1 : 1,
                }));
            }
        }

        if(this.batch.size >= this.options.batchSize) {
            // TODO: if batch size is *exceeded* should we split the batch?
            this._run();
        } else if(this.start) {
            // if the timer has been started...
            let elapsed = performance.now() - this.start;
            if(elapsed >= this.options.maxDelay) {
                // if max delay is exceeded, send the batch immediately
                this._run();
            } else {
                // otherwise, restart the timer
                clearTimeout(this.timer);
                this.timer = setTimeout(this._run, Math.min(this.options.minDelay, this.options.maxDelay - elapsed));
            }
        } else {
            // otherwise start the timer and queue the execution
            this.start = performance.now();
            this.timer = setTimeout(this._run, this.options.minDelay);
        }
    };

    _run = () => {
        clearTimeout(this.timer);
        this.start = null;
        this.timer = null;
        this._send();
        this.batch.clear();
    };

    _send = () => {
        let batchIdx = 0;
        let batch = [];
        let reqData = [];
        let keyLookup = Object.create(null);
        let rank = ++this.rankCounter;
        
        this.batch.forEach((reqs,key) => {
            if(!reqs.length) {
                return;
            }
            
            batch[batchIdx] = reqs;
            keyLookup[batchIdx] = key;
            
            for(let req of reqs) {
                this.rankLookup[req._id] = rank;
            }
            
            reqData[batchIdx] = {
                route: reqs[0].route,
                data: reqs[0].data,
            };

            ++batchIdx;
        });
        
        
        // let reqData = batch.filter(reqs => reqs.length).map((reqs,key) => {
        //     let counter = this.pending[key] = this.pending[key] ? this.pending[key] + 1 : 1; 
        //     console.log(key,counter);
        //    
        //     return {
        //         route: reqs[0].route,
        //         data: reqs[0].data,
        //         counter,
        //     };
        // });
        
        // console.log(reqData);
        
        let {headers, ...options} = resolveValue(this.options.fetchOptions) || {};
        
        // console.log('send',this.endpoint,reqData);
        
        fetch(this.options.endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            ...options,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify({
                rank: rank,
                requests: reqData,
            }),
        })
            .then(res => res.json())
            .then(fullResponse => {
                const {
                    rank: resRank,
                    responses,
                } = fullResponse;
                
                if(reqData.length !== responses.length) {
                    throw new Error(`Server error: response length (${responses.length}) does not match request length (${reqData.length})`);
                }
                for(let i = 0; i < responses.length; ++i) {
                    let res = responses[i];
                    
                    if(this.options.cache && res.type === 'success') {
                        this.options.cache.set(keyLookup[i], res.payload);
                    }
                    
                    for(let req of batch[i]) {
                        let expectedRank = this.rankLookup[req._id];
                        
                        if(!resRank || resRank == expectedRank) {
                            switch(res.type) {
                                case 'success':
                                    success(req, res.payload); 
                                    break;
                                case 'error':
                                    if(process.env.NODE_ENV !== 'production') {
                                        console.group(`Error in response to route "${req.route}"`);
                                        console.error(res.payload.message);
                                        console.info("Request:", req);
                                        console.info("Response:", res.payload);
                                        console.groupEnd();
                                    }

                                    if(req.errorProp) {
                                        req._component.setState({
                                            [req.errorProp]: res.payload,
                                        });
                                    }
                                    break;
                                default:
                                    throw new Error(`Server error: unexpected response type "${res.type}"`);
                            }
                        } else {
                            console.group(`Got stale response to route "${req.route}"`);
                            console.warn(`Expected ${expectedRank}, got ${resRank}`);
                            console.info("Request:", req);
                            console.info("Response:", res);
                            console.groupEnd();
                        }
                        if(req.loadingProp) {
                            req._component.setState(state => {
                                if(state[req.loadingProp] > 0) {
                                    return {
                                        [req.loadingProp]: state[req.loadingProp] ? state[req.loadingProp] - 1 : 0,
                                    };
                                }
                                return {};
                            });
                        }
                    }
                }
            });
    }
}

function success(req, payload) {
    let newState = req.handler.call(req._component, payload, req);
    if(newState !== undefined) {
        // console.log('newState', req, res);
        req._component.setState(newState);
    }
}

function setDefaults(obj, defaults, overwrite) {
    for(let key of Object.keys(defaults)) {
        if(obj[key] === undefined) {
            obj[key] = defaults[key];
        }
    }
}

function map2obj(map) {
    return Array.from(map).reduce((obj, [key, value]) => (
        Object.assign(obj, { [key]: value }) // Be careful! Maps can have non-String keys; object literals can't.
    ), {});
}


function map(iter, cb) {
    let out = [];
    let i = -1;
    for(let x of iter) {
        out.push(cb(x,++i));
    }
    return out;
}

function mapValues(iter, cb) {
    let out = new Array(iter.size);
    let i = 0;
    for(let x of iter.values()) {
        out[i] = cb(x,i);
        ++i;
    }
    return out;
}

function arrayIncludes(arr, cb) {
    for(let i=0; i<arr.length; ++i) {
        if((cb(arr[i],i))) {
            return true;
        }
    }
    return false;
}

function filterInPlace(a, condition) {
    // https://stackoverflow.com/a/37319954/65387
    let i = 0, j = 0, removed = 0;

    while(i < a.length) {
        const val = a[i];
        if(condition(val, i, a)) a[j++] = val;
        else ++removed;
        ++i;
    }

    a.length = j;
    return removed;
}

function splitArray(array, index) {
    return [array.slice(0, index), array.slice(index)];
}

/**
 * Unwraps a value. If passed a function, evaluates that function with the provided args. Otherwise, returns the value as-is.
 *
 * @param {Function|*} functionOrValue Function or value
 * @param {*} args Arguments to pass if `functionOrValue` is a function
 * @returns {*} The value passed in or the result of calling the function
 */
function resolveValue(functionOrValue, ...args) {
    return typeof functionOrValue === 'function' ? functionOrValue.call(this, ...args) : functionOrValue;
}

function setStateHandler(data, options) {
    this.setState({
        [options.dataProp]: data,
    });
}