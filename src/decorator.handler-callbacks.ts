import {AsyncLambdaHandler} from "./async-lambda-handler.type";
import {IContext} from "./context-interface";

export type PreCallback<I> = (input: I, ctx: unknown) => (Promise<unknown> | unknown);
export type PostCallback<O> = (response: O, ctx: IContext) => (Promise<unknown> | unknown);

export type ErrorCallback = Array<(err: Error, ctx: IContext) => (Promise<unknown> | unknown)>;

export interface ICallbacks<I, O> {
	pre?: Array<PreCallback<I>>;
	post?: Array<PostCallback<O>>;
	handleError?: ErrorCallback[];
}

/**
 *
 * @param handler
 * @param callbacks
 */
export function decorateHandlerWithCallbacks<I, O>(
	handler: AsyncLambdaHandler<I, O>,
	callbacks: ICallbacks<I, O>,
): AsyncLambdaHandler<I, O> {
	const completeCallbacks = Object.assign({
		handleError: [],
		post: [],
		pre: [],
	}, callbacks);
	return async (input, ctx) => {
		try {
			await Promise.all(completeCallbacks.pre.map((c) => c(response, ctx)));
			const response = await handler(input, ctx);
			await Promise.all(completeCallbacks.post.map((c) => c(response, ctx)));

			return response;
		} catch (err) {
			await Promise.all(completeCallbacks.handleError.map((c) => c(err, ctx)));

			throw err;
		}
	};
}