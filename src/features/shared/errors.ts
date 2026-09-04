export class DomainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {}

export class NotFoundError extends DomainError {}

export class ConflictError extends DomainError {}
