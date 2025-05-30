import styled from 'styled-components';

function RadioButton({ register }) {
  return (
    <StyledRadioButton>
      <Choice>
        <Input
          type="radio"
          id="easy"
          name="difficulty"
          value="easy"
          {...register('difficultyLevel')}
        />
        <Label htmlFor="easy">
          <RadioSpan />
          Easy
        </Label>
      </Choice>

      <Choice>
        <Input
          type="radio"
          id="medium"
          name="difficulty"
          value="medium"
          {...register('difficultyLevel')}
        />
        <Label htmlFor="medium">
          <RadioSpan />
          Medium
        </Label>
      </Choice>

      <Choice>
        <Input
          type="radio"
          id="hard"
          name="difficulty"
          value="hard"
          {...register('difficultyLevel')}
        />
        <Label htmlFor="hard">
          <RadioSpan />
          Hard
        </Label>
      </Choice>
    </StyledRadioButton>
  );
}

const StyledRadioButton = styled.div`
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  max-width: 100%;
  position: relative;
`;

const Choice = styled.p`
  margin: 0;
  padding: 0;
`;

const Label = styled.label`
  cursor: pointer;
  display: flex;
  align-items: center;
  font-weight: 600;

  &:not(:last-of-type) {
    margin-right: 1.5em;
  }
`;

const Input = styled.input`
  position: fixed;
  opacity: 0;
  pointer-events: none;

  &:checked + ${Label} {
    color: var(--color-brand-600);
  }

  &:checked + ${Label} span {
    color: var(--color-brand-600);
  }
`;

const RadioSpan = styled.span`
  display: inline-block;
  margin-right: 0.5em;
  vertical-align: bottom;
  border-radius: 50%;
  width: 1.5em;
  height: 1.5em;
  box-shadow: 0 0 0 0.15em var(--color-grey-600) inset,
    0 0.15em 0.15em rgba(0, 0, 0, 0);
  position: relative;

  ${Input}:checked + ${Label} & {
    box-shadow: 0 0 0 0.15em var(--color-brand-600) inset,
      0 0.15em 0.15em rgba(0, 0, 0, 0);

    &::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 0.75em;
      height: 0.75em;
      background-color: var(--color-brand-600);
      border-radius: 50%;
    }
  }
`;

export default RadioButton;
