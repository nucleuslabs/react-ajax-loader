import React from 'react';

export default class AjaxLoader {

    constructor({endpoint, batchSize = 4, minDelay = 8, maxDelay = 32}) {
        this.endpoint = endpoint;
        this.batchSize = batchSize;
        this.minDelay = minDelay;
        this.maxDelay = maxDelay;
        this.batch = [];
        this.start = null;
        this.timer = null;

        if(this.batchSize <= 0) {
            throw new Error(`batchSize must be > 0, got ${this.batchSize}`);
        }
    }

    hoc(...requests) {
        const loader = this;

        return function ajaxLoaderEnhancer(BaseComponent) {

            class AjaxEnhanced extends React.Component {
                static displayName = `ajaxLoader(${BaseComponent.displayName || BaseComponent.name || 'Component'})`;

                componentWillMount() {
                    this._refresh();
                }

                _refresh = () => {
                    loader._push(requests);
                };

                render() {
                    return React.createElement(BaseComponent, {...this.props, ...this.state});
                }
            }

            return AjaxEnhanced;
        }
    }

    _push = requests => {
        this.batch.push(...requests);

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
        this._send(this.batch);
        this.batch.length = 0;
    }

    _send = batch => {
        console.log('send',[...batch]);
    }
}

function splitArray(array, index) {
    return [array.slice(0, index), array.slice(index)];
}