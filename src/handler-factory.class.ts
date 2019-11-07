import {EventEmitter} from "events";
import {IContext} from "./context-interface";
import {HandlerCustomError} from "./error.handler-custom.class";
import IHandlerFactory, {ICallbacks} from "./handler-facotory.interface";

export type LambdaHandler<Input, Output> = (
	input: Input,
	ctx: IContext,
	cb: (error?: Error, data?: Output) => unknown,
) => unknown;

/**
 * Emitted event types
 */
export enum handlerEventType {
	called = "called",
	succeeded = "succeeded",
	error = "error",
	finished = "finished",
	timeOut = "timeOut",
	persisted = "persisted",
}

/**
 * The base factory for creating handlers.
 * e.g.
 *
 * ```typescript
 * import {AwsLambdaHandlerFactory, HandlerEventType} from 'sls-handler-factory';
 * const factory = new AwsLambdaHandlerFactory();
 * factory.eventEmitter.on(HandlerEventType.error, (err) => console.log(err.stack));
 * factory.callbacks.onSucceeded(async () => {
 *     // Here you can handle infrastructure, e.g. here you could persist the domain state.
 * });
 * export const handle = factory.build(async (input, ctx) => {
 *     // Here lies your domain logic.
 * });
 * ```
 *
 */
export class AwsLambdaHandlerFactory implements IHandlerFactory {

	/**
	 * Emits the events defined in the HandlerEventType enum
	 * IMPORTANT!!
	 * Remember to handle the 'error' events
	 * https://nodejs.org/api/events.html#events_error_events
	 */
	public readonly eventEmitter = new EventEmitter();

	/**
	 * Functions executed in some execution points.
	 * - To add some action, push the callback function to the array
	 * - admits async functions.
	 */
	public readonly callbacks: ICallbacks = {
		flush: [],
		handleError: [],
		initialize: [],
		persist: [],
	};

	/**
	 * The security timeout ms margin to emit the timeOut event.
	 */
	public timeOutSecureMargin = 500;

	private timer: any;

	/**
	 * @generic I The input received by the handler
	 * @generic O The output emitted by the handler
	 * @param handler Your own handler
	 */
	public build<I, O>(handler: (event: I, ctx: IContext) => Promise<O> | O): LambdaHandler<I, O> {
		return async (input, ctx, cb) => {
			await Promise.all(this.callbacks.initialize.map((c) => c(input, ctx)));
			this.eventEmitter.emit(handlerEventType.called, input, ctx);
			this.controlTimeOut(ctx);
			try {
				const response = await handler(input, ctx);
				await Promise.all(this.callbacks.persist.map((c) => c(response, ctx)));
				this.eventEmitter.emit(handlerEventType.persisted, response);
				await Promise.all(this.callbacks.flush.map((c) => c(response, ctx)));
				this.eventEmitter.emit(handlerEventType.succeeded, response);
				this.eventEmitter.emit(handlerEventType.finished);
				this.clearTimeOutControl();
				cb(null, response);
			} catch (err) {
				await Promise.all(this.callbacks.handleError.map((c) => c(err, ctx)));
				this.eventEmitter.emit(handlerEventType.error, err);
				this.eventEmitter.emit(handlerEventType.finished);
				this.clearTimeOutControl();
				if (err instanceof HandlerCustomError) {
					cb(null, err.response);
				} else {
					cb(err);
				}
			}
		};
	}

	private controlTimeOut(ctx: IContext) {
		if (ctx.getRemainingTimeInMillis === undefined) {
			return;
		}
		const remainingTime = ctx.getRemainingTimeInMillis() - this.timeOutSecureMargin;
		if (remainingTime <= 0) {
			return;
		}
		this.timer = setTimeout(() => this.eventEmitter.emit(handlerEventType.timeOut), remainingTime);
	}

	private clearTimeOutControl() {
		if (this.timer === undefined) {
			return;
		}
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}
