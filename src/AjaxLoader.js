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
        
        defaultDataProp = 'ajaxData',
        defaultLoadingProp = 'ajaxLoading',
        defaultErrorProp = 'ajaxError',
        defaultEqualityCheck = shallowEqual,
        defaultHandler = setStateHandler,
        defaultFetchPolicy = FP.CacheAndNetwork,
      
    }) {
        // TODO: move these all into this.options instead?
        this.endpoint = endpoint;
        this.cache = cache;
        this.hash = hash;
        this.batchSize = batchSize;
        this.minDelay = minDelay;
        this.maxDelay = maxDelay;
        this.batch = new Map;
        this.start = null;
        this.timer = null;
        this.fetchOptions = fetchOptions;
        
        this.defaultDataProp = defaultDataProp;
        this.defaultLoadingProp = defaultLoadingProp;
        this.defaultErrorProp = defaultErrorProp;
        this.defaultEqualityCheck = defaultEqualityCheck;
        this.defaultHandler = defaultHandler;
        this.defaultFetchPolicy = defaultFetchPolicy;
        
        this.reqCounter = 0;

        if(this.batchSize <= 0) {
            throw new Error(`batchSize must be > 0, got ${this.batchSize}`);
        }
    }

    hoc(...requests) {
        const loader = this;
        
        for(let req of requests) {
            setDefaults(req, {
                equalityCheck: this.defaultEqualityCheck,
                handler: this.defaultHandler,
                loadingProp: this.defaultLoadingProp,
                errorProp: this.defaultErrorProp,
                dataProp: this.defaultDataProp,
                refreshProp: null,
                fetchPolicy: this.defaultFetchPolicy,
            }, {
                _id: ++this.reqCounter,
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
                    for(let req of this.requests) {
                        if(req.refreshProp) {
                            props[req.refreshProp] = () => {
                                if(typeof req.data === 'function') {
                                    let data = req.data.call(this, this.props);
                                    this.lastData[req._id] = data;
                                    req = {...req, data};
                                }
                                loader._push(req);
                            };
                        }
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
            let key = this.hash([req.route,req.data]);
            
            if(this.cache && req.fetchPolicy !== FP.NetworkOnly) {
                let res = this.cache.get(key);
                if(res !== undefined) {
                    success(req, res);
                    if(req.fetchPolicy !== FP.CacheAndNetwork) {
                        continue;
                    }
                    cacheHit = true;
                }
            }
            
            let entry = this.batch.get(key);
            if(entry) {
                entry.push(req);
            } else {
                this.batch.set(key, [req]);
            }

            if(req.loadingProp && !cacheHit) {
                // FIXME: if there's a cache hit but fetch policy is cache-and-network, then....should we show the loading or not? 
                // FIXME: why are the results flashing when there was a cache hit..?
                req._component.setState(state => ({
                    [req.loadingProp]: state[req.loadingProp] ? state[req.loadingProp] + 1 : 1,
                }));
            }
        }

        if(this.batch.size >= this.batchSize) {
            // TODO: if batch size is *exceeded* should we split the batch?
            this._run();
        } else if(this.start) {
            // if the timer has been started...
            let elapsed = performance.now() - this.start;
            if(elapsed >= this.maxDelay) {
                // if max delay is exceeded, send the batch immediately
                this._run();
            } else {
                // otherwise, restart the timer
                clearTimeout(this.timer);
                this.timer = setTimeout(this._run, Math.min(this.minDelay, this.maxDelay - elapsed));
            }
        } else {
            // otherwise start the timer and queue the execution
            this.start = performance.now();
            this.timer = setTimeout(this._run, this.minDelay);
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
        let batch = new Array(this.batch.size);
        let keyLookup = Object.create(null);
        this.batch.forEach((reqs,key) => {
            batch[batchIdx] = reqs;
            keyLookup[batchIdx] = key;
            ++batchIdx;
        });
        
        let reqData = batch.map(reqs => ({
            route: reqs[0].route,
            data: reqs[0].data,
        }));
        
        let {headers, ...options} = resolveValue(this.fetchOptions) || {};
        
        // console.log('send',this.endpoint,reqData);
        
        fetch(this.endpoint, {
            method: 'POST',
            credentials: 'same-origin',
            ...options,
            headers: {
                'Accept': 'application/json, text/plain, */*',
                'Content-Type': 'application/json',
                ...headers,
            },
            body: JSON.stringify(reqData),
        })
            .then(res => res.json())
            .then(responses => {
                if(reqData.length !== responses.length) {
                    throw new Error(`Server error: response length (${responses.length}) does not match request length (${reqData.length})`);
                }
                for(let i = 0; i < responses.length; ++i) {
                    let res = responses[i];
                    
                    if(this.cache && res.type === 'success') {
                        this.cache.set(keyLookup[i], res.payload);
                    }
                    
                    for(let req of batch[i]) {
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
                        if(req.loadingProp) {
                            req._component.setState(state => ({
                                [req.loadingProp]: state[req.loadingProp] ? state[req.loadingProp] - 1 : 0,
                            }));
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
    for(let key of Object.keys(overwrite)) {
        obj[key] = overwrite[key];
    }
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