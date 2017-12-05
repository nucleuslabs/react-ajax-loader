import React from 'react';

export default class AjaxLoader {
    
    
    constructor({endpoint,batchSize=4,minDelay=8,maxDelay=32}) {
        this.endpoint = endpoint;
        this.batchSize = batchSize;
        this.minDelay = minDelay;
        this.maxDelay = 32;
        this.batch = [];
        this.start = null;
        this.timer = null;
    }
    
    enhance(...requests) {
        const loader = this;
        
        return function ajaxLoaderEnhancer(BaseComponent) {
            
            class AjaxEnhanced extends React.Component {
                static displayName = `ajaxLoader(${BaseComponent.displayName || BaseComponent.name || 'Component'})`;
                
                componentWillMount() {
                    this._refresh();
                }
                
                _refresh = () => {
                    loader._push(...requests);
                };
                
                render() {
                    return React.createComponent(BaseComponent, {...this.props, ...this.state});
                }
            }
        }
    }
    
    _push(...requests) {
        this.batch.push(...requests);
        
        if(this.batch.length >= this.batchSize) {
            
        } else if(this.start && (performance.now() - start) >= this.maxDelay) {
            
        } else {
            this.start = performance.now();
            this.timer = setTimeout(_, this.minDelay);
        }
    }
}