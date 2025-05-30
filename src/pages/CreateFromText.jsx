import CreateFromTextForm from '../features/Create/CreateFromTextForm';
import Heading from '../ui/Heading';
import Row from '../ui/Row';

function CreateFromText() {
  return (
    <>
      <Row type="horizontal">
        <Heading as="h1">Create from text</Heading>
      </Row>
      <CreateFromTextForm />
    </>
  );
}

export default CreateFromText;
