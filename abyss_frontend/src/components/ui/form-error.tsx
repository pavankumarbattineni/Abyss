interface FormErrorProps {
  message?: string;
}

const FormError = ({ message }: FormErrorProps) => {
  if (!message) return null;
  return <p className="text-destructive text-xs">{message}</p>;
};

export { FormError };
