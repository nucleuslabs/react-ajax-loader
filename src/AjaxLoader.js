import React from 'react';
import shallowEqual from 'shallowequal';
import hash from 'object-hash';

export default class AjaxLoader {

    constructor({
        endpoint, 
        batchSize = 4, 
        minDelay = 8, 
        maxDelay = 32, 
        fetchOptions,
        
        defaultDataProp = 'data',
        defaultLoadingProp = 'loading',
        defaultErrorProp = 'error',
        defaultEqualityCheck = shallowEqual,
        defaultHandler = setStateHandler,
    }) {
        this.endpoint = endpoint;
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
        
        this.reqCounter = 0;

        if(this.batchSize <= 0) {
            throw new Error(`batchSize must be > 0, got ${this.batchSize}`);
        }
    }

    hoc(...requests) {
        const loader = this;
        
        for(let req of requests) {
            defaults(req, {
                equalityCheck: this.defaultEqualityCheck,
                handler: this.defaultHandler,
                loadingProp: this.defaultLoadingProp,
                errorProp: this.defaultErrorProp,
                dataProp: this.defaultDataProp,
                refreshProp: null,
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
                            let data = req.data.call(this, this.props);
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
                            }
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
            let key = hash([req.route,req.data]);
            let entry = this.batch.get(key);
            if(entry) {
                entry.push(req);
            } else {
                this.batch.set(key, [req]);
            }
        }

        for(let req of requests) {
            if(req.loadingProp) {
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
    }

    _run = () => {
        clearTimeout(this.timer);
        this.start = null;
        this.timer = null;
        this._send();
        this.batch.clear();
    };

    _send = () => {
        let reqMap = Array.from(this.batch.values());
        let reqData = reqMap.map(reqs => ({
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
                    for(let req of reqMap[i]) {
                        switch(res.type) {
                            case 'success': {
                                let newState = req.handler.call(req._component, res.payload, req);
                                if(newState !== undefined) {
                                    // console.log('newState', req, res);
                                    req._component.setState(newState);
                                }
                                break;
                            }
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
            })
    }
}

function defaults(obj, defaults, overwrite) {
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