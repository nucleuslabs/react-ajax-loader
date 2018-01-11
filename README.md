# react-ajax-loader

Higher-order component for loading data into your React components. Supports batching, deduping and caching requests.

### Installation

```bash
yarn add react-ajax-loader
```

### Usage

Create a file that exports an instance of `AjaxLoader`.

```js
// ajax-loader.js
import {AjaxLoader, MemoryCache} from 'react-ajax-loader';

export default new AjaxLoader({
    endpoint: '/path/to/your/special/endpoint.php',
    cache: new MemoryCache(), // <-- Cache responses in memory. Use `null` to *not* cache, or write your own to save data to `localStorage` or whatever you want.
    batchSize: 5, // Send up to 5 requests at once
    minDelay: 10, // Wait at least 10ms for more requests to come in (when components are mounted)
    maxDelay: 50, // Wait at most 50ms before sending the batch
    defaultDataProp: 'data', // Put successful requests into "data" prop
    defaultLoadingProp: 'loading', // Put count of pending requests into "loading" prop
    defaultErrorProp: 'error', // Put errors here
    refreshAllProp: 'refresh', // Re-send all requests when this.props.refresh() is called (skip cache)
    fetchOptions: () => { // <-- Merged into window.fetch()
        if(window.csrfToken) {
            return {
                headers: {
                    'X-Csrf-Token': window.csrfToken, // Pass a CSRF token with every request if you need to
                }
            };
        }
        return {};
    }
});
```

Write a special endpoint to handle batch requests. Here's an example in PHP from our project, but you can use any server-side language:

```php
<?php // special/endpoint.php

public static function handle(\NucleusLabs\JsonBag $batch) {
    $routeHandler = new \NucleusLabs\Routing\RouteHandler();

    $responses = [];

    $requests = $batch->get('requests');

    if(!$requests) {
        throw new \Exception("AjaxLoader batch request is missing 'requests'");
    }

    foreach($requests as $req) {
        try {
            $payload = $routeHandler->handleRoute($req['route'], $req['data']);
        } catch(\Exception $ex) {
            $responses[] = [
                'type' => 'error', // <-- Use this if the request failed
                'payload' => [ // <-- Payload can be whatever. It will be put into the "error" prop
                    'status' => $ex instanceof \Symfony\Component\HttpKernel\Exception\HttpExceptionInterface ? $ex->getStatusCode() : null,
                    'message' => $ex->getMessage(),
                    'code' => $ex->getCode(),
                ],

            ];
            continue;
        }

        $newEtag = md5(json_encode($payload, JSON_UNESCAPED_SLASHES));
        $oldEtag = $req['etag'] ?? [];

        if($newEtag === $oldEtag) {
            $responses[] = [
                'type' => 'nochange', // <-- Not necessary to implement, but will make the response smaller when the data hasn't changed on the server
            ];
        } else {
            $responses[] = [
                'type' => 'success',
                'payload' => $payload, // <-- Whatever you want. Will be put into "data" prop
                'etag' => $newEtag, // <-- Hash of the payload. Will be returned back to when you use the "cache-and-network" fetchPolicy and the request is cached. Use to avoid sending same payload again.
            ];
        }
    }

    return [
        'rank' => $batch->get('rank'), // <-- Return the "rank" as-is. It's used to discard stale requests when you send multiple in quick succession.
        'responses' => $responses,
    ];
}
```

Use the HOC in all of your components:

```jsx
// UserSelect.jsx
import ajaxLoader from './ajax-loader.js';
import pick from 'lodash/fp/pick';

const UserSelect = ajaxLoader.hoc({
    route: 'getUsers', // <-- Use to determine what function to call on the server
    data: pick(['programId']), // <-- Choose some props to pass along; ajax request will be re-sent whenever these change
})(({loading,data}) => {
    if(loading) {
        return <span>Loading...</span>;
    }
    
    return (
        <select>
            {data.map(opt => (
                <option key={opt.id} value={opt.id}>{opt.name}</option>
            ))}
        </select>
    );
});
```

### API

#### AjaxLoader.constructor(options)

```js
{
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
  
}) 
```


#### AjaxLoader.hoc(...requests)

```js
{
    equalityCheck: this.options.defaultEqualityCheck, // Used to compare old request data to new to determine if request needs to be re-sent. Defaults to a shallow compare
    handler: this.options.defaultHandler, // Invoked when request was successful. Copies response into `props[dataProp]` by default. Override this if you have special requirements. Return an object with properties to set.
    loadingProp: this.options.defaultLoadingProp, // Name of loading prop
    errorProp: this.options.defaultErrorProp, // Name of error prop
    dataProp: this.options.defaultDataProp, // Name of data prop. Not used if you override handler.
    refreshProp: null, // Name of prop used to re-send just this request. Use `refreshAllProp` to re-send all requests bound to this component.
    fetchPolicy: this.options.defaultFetchPolicy, // One of "cache-first", "cache-and-network", "network-only" or "cache-only"
}
```

### License

MIT.

