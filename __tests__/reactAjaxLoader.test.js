import React from 'react';
import {render, waitFor, act} from "@testing-library/react";
import fetchMock from 'fetch-mock';
import AjaxLoader from '../src/AjaxLoader';
import MemoryCache from '../src/MemoryCache';

const myAjaxLoader = new AjaxLoader({
    endpoint: 'http://example.com/path/to/your/special/endpoint.php',
    cache: new MemoryCache(),
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

const TestComponent = myAjaxLoader.hoc({
    route: 'getUsers',          // Doesn't matter with our mock
    data: {'whatever': 2},      // Doesn't matter with our mock
})(({loading,data}) => {
    if(loading) {
        return <div data-testid="loading_status">Loading...</div>;
    }

    return (
        <div>
            <div data-testid="loading_status">Loaded</div>
            <select data-testid="theselectbox">
                {data.map(opt => (
                    <option key={opt.id} value={opt.id}>{opt.name}</option>
                ))}
            </select>
        </div>
    );
});


describe('ajaxLoader basic functionality', () => {
    test('Verify ajaxLoader returns data and renders', async() => {
        fetchMock.post('http://example.com/path/to/your/special/endpoint.php', {
            'rank': 1,
            'responses': [
                {
                    'type': 'success',
                    'payload': [
                        {'id': 4, 'name': 'Tweety'},
                        {'id': 95, 'name': 'Sylvester'}
                    ]
                }
            ]
        });
        let {getByText, getByTestId, getAllByRole} = render(<TestComponent/>);
        await waitFor(() => getByText("Loaded"));
        expect((await getByTestId("loading_status")).textContent).toEqual('Loaded');
        expect(getAllByRole('option').length).toBe(2)
        fetchMock.resetBehavior();
    });
});

describe('ajaxLoader basic functionality on busted response', () => {
    test('Verify ajaxLoader continues to render Loading when the server has no response', async() => {
        fetchMock.post('http://example.com/path/to/your/special/endpoint.php', {throws: 'Server Not found'});
        let {getByText, getByTestId} = render(<TestComponent/>);
        await waitFor(() => getByText("Loading..."));
        expect((await getByTestId("loading_status")).textContent).toEqual('Loading...');
        fetchMock.resetBehavior();
    });
});