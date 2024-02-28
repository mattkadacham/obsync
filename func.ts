

export const SOME = Symbol("some");
export const NONE = Symbol("none");

export type Option<T> = {
    map: <Z>(f: (x: T) => Z) => Option<Z>;
    match: <Z>(some: (x: T) => Z, none: () => Z) => Z;
} & ({ value: T; type: typeof SOME } | { type: typeof NONE });

export namespace Option {


    export const Some = <X>(value: X): Option<X> => {
        return unit<X>(value);
    }

    export const None = <X>(): Option<X> => {
        return unit<X>(null);
    }

    export const unit = <X>(value: X | null): Option<X> => {
        const map = <Z>(f: (x: X) => Z) =>
            value === null
                ? unit<Z>(null)
                : unit<Z>(f(value));

        const match = <Z>(some: (x: X) => Z, none: () => Z) =>
            value === null
                ? none()
                : some(value);

        return value === null
            ? { map, match, type: NONE }
            : { map, match, value, type: SOME };
    };

    export const toResult = <X>(o: Option<X>, err: string): Result<X> => {
        switch (o.type) {
            case SOME:
                return Result.Ok(o.value);
            case NONE:
                return Result.Err(err);
        }
    }
}

export const OK = Symbol("ok");
export const ERR = Symbol("err");

export type Result<T> = {
    map: <Z>(f: (v: T) => Z) => Result<Z>;
    bind: <Z>(f: (v: T) => Result<Z>) => Result<Z>;
    bindAsync: <Z>(f: (v: T) => Promise<Result<Z>>) => Promise<Result<Z>>;
} & ({ value: T; type: typeof OK } | { err: string; type: typeof ERR });


export namespace Result {

    export const Err = <X>(err: string): Result<X> => unit<X>(null as never, err);

    export const Ok = <X>(value: X): Result<X> => unit<X>(value);

    export const unit = <X>(value: X, err = ""): Result<X> => {
        const map = <Z>(f: (v: X) => Z) => {
            try {
                return Ok<Z>(f(value));
            } catch (e) {
                return Err<Z>((e as Error).message ?? "error");
            }
        };

        const bind = <Z>(f: (v: X) => Result<Z>) => {
            try {
                return f(value);
            } catch (e) {
                return Err<Z>((e as Error).message ?? "error");
            }
        }

        const bindAsync = async <Z>(f: (v: X) => Promise<Result<Z>>) => {
            try {
                return await f(value);
            } catch (e) {
                return Err<Z>((e as Error).message ?? "error");
            }
        }

        const funcs = {
            map,
            bind,
            bindAsync
        }

        return (err || !value)
            ? { ...funcs, err, type: ERR }
            : { ...funcs, value, type: OK };
    };

    export const toOption = <X>(r: Result<X>): Option<X> => {
        switch (r.type) {
            case OK:
                return Option.Some(r.value);
            case ERR:
                return Option.None<X>();
        }
    };
}