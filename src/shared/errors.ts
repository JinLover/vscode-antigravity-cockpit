/**
 */
export class AntigravityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AntigravityError';
        Object.setPrototypeOf(this, AntigravityError.prototype);
    }
}

/**
 */
export function isServerError(err: Error): boolean {
    return err instanceof AntigravityError;
}
