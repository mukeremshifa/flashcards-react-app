import Textarea from '../../ui/Textarea';
import FormRow from '../../ui/FormRow';
import Form from '../../ui/Form';
import styled from 'styled-components';
import Input from '../../ui/Input';
import Button from '../../ui/Button';
import RadioButton from '../../ui/RadioButton';
import { useForm } from 'react-hook-form';

const onSubmit = data => {
  console.log('Form data:', data);
  // Send to API here
};

function CreateFromTextForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm();

  return (
    <Form onSubmit={handleSubmit(onSubmit)}>
      <FormContainer>
        <Label htmlFor="input-text">Input text</Label>
        <Textarea
          id="input-text"
          {...register('inputText', {
            required: 'This field is required',
            minLength: {
              value: 100,
              message: 'Must be at least 100 characters',
            },
          })}
        />
        {errors.inputText && <Error>{errors.inputText.message}</Error>}

        <FormRow label="Number of cards" error={errors?.numberOfCards?.message}>
          <Input
            type="number"
            defaultValue="10"
            id="numberOfCards"
            {...register('numberOfCards', {
              required: 'Number of cards is required',
              min: {
                value: 3,
                message: 'Minimum 3 cards',
              },
              max: {
                value: 100,
                message: 'Maximum 100 cards',
              },
            })}
          />
        </FormRow>

        <FormRow label="Difficulty level">
          <RadioButton register={register} />
        </FormRow>
      </FormContainer>

      <Button size="medium" disabled={isSubmitting}>
        Create cards
      </Button>
    </Form>
  );
}

const Label = styled.label`
  font-weight: 500;
`;

const Error = styled.span`
  font-size: 1.4rem;
  color: var(--color-red-700);
  margin-top: 0;
`;

const FormContainer = styled.div`
  background-color: var(--color-grey-0);
  border: 1px solid var(--color-grey-100);
  border-radius: var(--border-radius-md);
  padding: 2.4rem 4rem;
  overflow: hidden;
  font-size: 1.4rem;
`;

export default CreateFromTextForm;
