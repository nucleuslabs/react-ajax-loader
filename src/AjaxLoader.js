import React from 'react';
import shallowEqual from 'shallowequal';

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
        this.batch = [];
        this.start = null;
        this.timer = null;
        this.fetchOptions = fetchOptions;
        
        this.defaultDataProp = defaultDataProp;
        this.defaultLoadingProp = defaultLoadingProp;
        this.defaultErrorProp = defaultErrorProp;
        this.defaultEqualityCheck = defaultEqualityCheck;
        this.defaultHandler = defaultHandler;

        if(this.batchSize <= 0) {
            throw new Error(`batchSize must be > 0, got ${this.batchSize}`);
        }
    }

    hoc(...requests) {
        const loader = this;
        const lastData = Object.create(null);
        
        for(let i=0; i<requests.length; ++i) {
            Object.assign(requests[i], {
                equalityCheck: this.defaultEqualityCheck,
                handler: this.defaultHandler,
                loadingProp: this.defaultLoadingProp,
                errorProp: this.defaultErrorProp,
                dataProp: this.defaultDataProp,
                refreshProp: null,
            }, requests[i], {
                _id: i,
            });
        }

        return function ajaxLoaderEnhancer(BaseComponent) {

            class AjaxEnhanced extends React.Component {
                static displayName = `ajaxLoader(${BaseComponent.displayName || BaseComponent.name || 'Component'})`;
                
                constructor(props) {
                    super(props);
                    for(let req of requests) {
                        req._component = this; // FIXME: what if this same enhancer is used on multiple components?? do we need to copy the requests into this.requests?
                    }
                }
                
                componentWillMount() {
                    loader._push(requests.map(req => {
                        if(typeof req.data === 'function') {
                            let data = req.data.call(this, this.props);
                            lastData[req._id] = data;
                            req = {...req, data};
                        }

                        return req;
                    }));
                }

                componentWillReceiveProps(nextProps) {
                    let updated = requests.reduce((acc, req) => {
                        if(typeof req.data === 'function') {
                            let data = req.data.call(this, this.props);
                            if(!this.equalityCheck(lastData[req._id], data)) {
                                lastData[req._id] = data;
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
                    for(let req of requests) {
                        if(req.refreshProp) {
                            props[req.refreshProp] = () => {
                                if(typeof req.data === 'function') {
                                    let data = req.data.call(this, this.props);
                                    lastData[req._id] = data;
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
        this.batch.push(...requests);

        for(let req of requests) {
            if(req.loadingProp) {
                req._component.setState(state => ({
                    [req.loadingProp]: state[req.loadingProp] ? state[req.loadingProp] + 1 : 1,
                }));
            }
        }

        if(this.batch.length >= this.batchSize) {
            // if batch size is met
            if(this.batch.length > this.batchSize) {
                // if batch exceeds maximum batch size, send first chunk and re-queue the remainder
                let first = this.batch.slice(0, this.batchSize);
                let rest = this.batch.slice(this.batchSize);
                this.batch = first;
                this._run();
                this._push(rest);
            } else {
                // otherwise send whole batch immediately
                this._run();
            }
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
        this.batch.length = 0;
    };

    _send = () => {
     
        let requests = [...this.batch];
        let reqData = requests.map(({route,data}) => ({route,data}));
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
                if(requests.length !== responses.length) {
                    throw new Error(`Server error: response length (${responses.length}) does not match request length (${requests.length})`);
                }
                for(let i = 0; i < responses.length; ++i) {
                    let res = responses[i];
                    let req = requests[i];
                    switch(responses[i].type) {
                        case 'success': {
                            let newState = req.handler.call(req._component, res.payload, req);
                            if(newState !== undefined) {
                                console.log('newState',req,res);
                                req._component.setState(newState);
                            }
                            break;
                        }
                        case 'error':
                            if(process.env.NODE_ENV !== 'production') {
                                console.group(`Error in response to route "${requests[i].route}"`);
                                console.error(res.payload.message);
                                console.info("Request:", requests[i]);
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
            })
    }
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